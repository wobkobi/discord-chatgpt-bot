import { Client, Message } from "discord.js";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { defaultCooldownConfig } from "../config.js";
import {
  cloneUserId,
  getCharacterDescription,
} from "../data/characterDescription.js";
import { updateCloneMemory } from "../memory/cloneMemory.js";
import { updateUserMemory, userMemory } from "../memory/userMemory.js";
import { ChatMessage, ConversationContext } from "../types/types.js";
import {
  getCooldownContext,
  isCooldownActive,
  manageCooldown,
  useCooldown,
} from "../utils/cooldown.js";
import { ensureFileExists, markContextAsUpdated } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/**
 * Removes "@" symbols from text.
 */
function removeAtSymbols(text: string): string {
  return text.replace(/@/g, "");
}

/**
 * Fixes mention formatting by wrapping IDs in <@...>.
 */
function fixMentions(content: string): string {
  return content.replace(/<(\d+)>/g, "<@$1>");
}

/**
 * Wraps math expressions (detected as text within square brackets containing a backslash)
 * in inline code formatting.
 *
 * Example: [ t = \frac{v_f - v_i}{a} ] becomes ` [ t = \frac{v_f - v_i}{a} ] `
 *
 * @param content - The text content to process.
 * @returns The processed text with math expressions wrapped in backticks.
 */
function fixMathFormatting(content: string): string {
  return content.replace(/(\[[^\]]*\\[^\]]*\])/g, (match) => `\`${match}\``);
}

/**
 * Applies Discord markdown formatting to the given text.
 * It fixes mentions, applies math formatting, and if the text spans multiple lines,
 * wraps the entire text in a code block.
 *
 * @param text - The text to format.
 * @returns The text formatted with Discord markdown.
 */
function applyDiscordMarkdownFormatting(text: string): string {
  let formatted = fixMentions(text);
  formatted = fixMathFormatting(formatted);
  // If the formatted text contains newlines, wrap it in a multiline code block.
  if (formatted.includes("\n")) {
    formatted = "```\n" + formatted + "\n```";
  }
  return formatted;
}

/**
 * Determines a conversation context ID based on message and existing conversation IDs.
 */
function getContextId(message: Message, convIds: Map<string, string>): string {
  if (!message.guild) return message.channel.id;
  const replyToId = message.reference?.messageId;
  return replyToId && convIds.has(replyToId)
    ? convIds.get(replyToId)!
    : `${message.channel.id}-${message.id}`;
}

/**
 * Creates a ChatMessage object from a Discord message.
 */
function createChatMessage(
  message: Message,
  role: "user" | "assistant",
  botName?: string
): ChatMessage {
  return {
    id: message.id,
    role,
    name:
      role === "user"
        ? sanitiseUsername(message.author.username)
        : (botName ?? "Bot"),
    userId: role === "user" ? message.author.id : undefined,
    content: message.content,
    replyToId: message.reference?.messageId,
  };
}

/**
 * Sanitises a username by removing disallowed characters.
 */
function sanitiseUsername(username: string): string {
  const clean = username.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 64);
  return clean || "unknown_user";
}

/**
 * Generates a reply using OpenAI based on conversation context and long-term memory.
 */
async function generateReply(
  messages: Map<string, ChatMessage>,
  currentMessageId: string,
  openai: OpenAI,
  contextKey: string
): Promise<string> {
  const context: { role: "user" | "assistant" | "system"; content: string }[] =
    [];
  let currentId: string | undefined = currentMessageId;

  // Build conversation context by traversing the reply chain.
  while (currentId) {
    const msg = messages.get(currentId);
    if (!msg) break;
    const sanitized = removeAtSymbols(msg.content);
    const content =
      msg.role === "user"
        ? `${msg.name} (ID: ${msg.userId}) asked: ${sanitized}`
        : sanitized;
    context.unshift({ role: msg.role, content });
    currentId = msg.replyToId;
  }

  // Append long-term memory if available.
  const memoryEntries = userMemory.get(contextKey) || [];
  const memoryContent = memoryEntries.map((entry) => entry.content).join("\n");
  if (memoryContent) {
    context.unshift({
      role: "system",
      content: `Long-term memory:\n${memoryContent}`,
    });
  }

  // Prepend the character description.
  const characterDescription = (
    await getCharacterDescription(contextKey)
  ).trim();
  const finalMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: characterDescription, name: undefined },
    ...context.map((msg) => ({
      role: msg.role,
      content: msg.content,
      name: undefined,
    })),
  ];

  logger.info("Full prompt context: " + JSON.stringify(finalMessages, null, 2));

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: finalMessages,
      top_p: 0.6,
      frequency_penalty: 0.5,
      max_tokens: 2000,
    });
    const replyContent: string | null = response.choices[0]?.message.content;
    if (!replyContent) {
      throw new Error("Received an empty response from the AI.");
    }
    return replyContent.trim();
  } catch (error: unknown) {
    logger.error("Error processing ChatGPT response:", error);
    if (error instanceof APIError && error.code === "insufficient_quota") {
      return `I've reached my limit of wisdom for now. Please pay <@${process.env.OWNER_ID}> money to get more credits.`;
    }
    throw new Error("There was an error processing your request.");
  }
}

/**
 * Summarizes the last three messages in the conversation context.
 */
function summarizeConversation(context: ConversationContext): string {
  const msgs = Array.from(context.messages.values());
  return msgs
    .slice(-3)
    .map((msg) => msg.content)
    .join(" ");
}

const conversationHistories: Map<
  string,
  Map<string, ConversationContext>
> = new Map();
const conversationIdMap: Map<string, Map<string, string>> = new Map();
const CONVERSATION_MESSAGE_LIMIT = 10;

/**
 * Handles a new message event: builds context, applies cooldowns, and generates a reply.
 */
export async function handleNewMessage(openai: OpenAI, client: Client) {
  return async function (message: Message<boolean>): Promise<void> {
    if (message.author.bot) return;

    const userId = message.author.id;
    const contextKey = userId;
    initialiseConversationData(contextKey);

    // Send typing indicator if in DM or if bot is mentioned.
    if (!message.guild) {
      if (message.channel.isTextBased() && "sendTyping" in message.channel) {
        message.channel.sendTyping();
      }
    } else if (
      message.author.id !== cloneUserId &&
      message.mentions.has(client.user?.id ?? "")
    ) {
      if (message.channel.isTextBased() && "sendTyping" in message.channel) {
        message.channel.sendTyping();
      }
    }
    await processMessage(message, contextKey, openai, client);
  };
}

/**
 * Processes an incoming message: updates history, checks cooldowns, fetches context, and sends a reply.
 */
async function processMessage(
  message: Message<boolean>,
  contextKey: string,
  openai: OpenAI,
  client: Client
): Promise<void> {
  // Update clone memory even if the message is from the clone.
  if (message.author.id === cloneUserId) {
    await updateCloneMemory(cloneUserId, {
      timestamp: Date.now(),
      content: message.content,
    });
  }

  const convIds = conversationIdMap.get(contextKey)!;
  const contextId: string = getContextId(message, convIds);
  const guildId = message.guild ? message.guild.id : null;
  const cooldownContext = getCooldownContext(guildId, message.author.id);

  // Check and apply cooldown.
  if (useCooldown && isCooldownActive(cooldownContext)) {
    const currentCooldown = defaultCooldownConfig.cooldownTime.toFixed(2);
    const cooldownMsg = await message.reply(
      `You're sending messages too quickly. The server cooldown is set to ${currentCooldown} seconds. Please wait before asking another question.`
    );
    setTimeout(() => {
      cooldownMsg.delete().catch(logger.error);
    }, 5000);
    return;
  }
  if (useCooldown) {
    manageCooldown(guildId, message.author.id);
  }

  // Retrieve or create the conversation context.
  const convHist = conversationHistories.get(contextKey)!;
  const conversationContext: ConversationContext = convHist.get(contextId) || {
    messages: new Map<string, ChatMessage>(),
  };
  convHist.set(contextId, conversationContext);
  convIds.set(message.id, contextId);

  const newMsg: ChatMessage = createChatMessage(
    message,
    "user",
    client.user?.username ?? "Bot"
  );
  conversationContext.messages.set(message.id, newMsg);

  // If in a guild and the bot is interjecting, fetch recent channel history.
  if (message.guild && !message.mentions.has(client.user?.id ?? "")) {
    try {
      const fetchedMessages = await message.channel.messages.fetch({
        limit: 10,
      });
      const sortedMessages = Array.from(fetchedMessages.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );
      for (const fetchedMsg of sortedMessages) {
        if (
          !fetchedMsg.author.bot &&
          !conversationContext.messages.has(fetchedMsg.id)
        ) {
          const chatMsg = createChatMessage(
            fetchedMsg,
            "user",
            client.user?.username ?? "Bot"
          );
          conversationContext.messages.set(fetchedMsg.id, chatMsg);
        }
      }
    } catch (error) {
      logger.error("Error fetching channel history:", error);
    }
  }

  // Summarize conversation if the context becomes too large.
  if (conversationContext.messages.size >= CONVERSATION_MESSAGE_LIMIT) {
    const summary = summarizeConversation(conversationContext);
    await updateUserMemory(newMsg.userId!, {
      timestamp: Date.now(),
      content: `Summary for conversation ${contextId}: ${summary}`,
    });
    conversationContext.messages.clear();
  }

  try {
    const replyContent: string = await generateReply(
      conversationContext.messages,
      message.id,
      openai,
      contextKey
    );
    // Apply Discord markdown formatting to the reply.
    const formattedReply = applyDiscordMarkdownFormatting(replyContent);
    const sentMessage = await message.reply(formattedReply);

    const botMsg: ChatMessage = createChatMessage(
      sentMessage,
      "assistant",
      client.user?.username ?? "Bot"
    );
    conversationContext.messages.set(sentMessage.id, botMsg);
    convIds.set(sentMessage.id, contextId);

    const summary = summarizeConversation(conversationContext);
    await updateUserMemory(newMsg.userId!, {
      timestamp: Date.now(),
      content: `Conversation ${contextKey} (asked by ${newMsg.name}): ${summary}`,
    });
    await ensureFileExists(
      [contextKey],
      conversationHistories,
      conversationIdMap
    );
  } catch (error: unknown) {
    await handleError(message, error);
  }
}

/**
 * Handles errors by logging and sending a fallback error reply.
 */
async function handleError(
  message: Message<boolean>,
  error: unknown
): Promise<void> {
  logger.error("Failed to process message:", error);
  await message.reply("An error occurred while processing your request.");
}

/**
 * Initializes conversation storage for a given context key.
 */
function initialiseConversationData(key: string): void {
  if (!conversationHistories.has(key)) {
    conversationHistories.set(key, new Map());
    conversationIdMap.set(key, new Map());
  }
  markContextAsUpdated(key);
}

/**
 * Initializes conversation storage from disk on startup.
 */
export async function run(client: Client): Promise<void> {
  try {
    const guildIds: string[] = Array.from(client.guilds.cache.keys());
    await ensureFileExists(guildIds, conversationHistories, conversationIdMap);
  } catch (error: unknown) {
    logger.error("Failed to initialise conversations:", error);
    process.exit(1);
  }
}
