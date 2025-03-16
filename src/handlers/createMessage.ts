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

/**
 * Removes "@" symbols from text.
 */
function removeAtSymbols(text: string): string {
  return text.replace(/@/g, "");
}

/**
 * Fixes mention formatting so that IDs appear correctly.
 */
function fixMentions(content: string): string {
  return content.replace(/<(\d+)>/g, "<@$1>");
}

/**
 * Determines a conversation context ID.
 */
function getContextId(message: Message, convIds: Map<string, string>): string {
  if (!message.guild) {
    return message.channel.id;
  }
  const replyToId = message.reference?.messageId;
  return replyToId && convIds.has(replyToId)
    ? convIds.get(replyToId)!
    : `${message.channel.id}-${message.id}`;
}

/**
 * Creates a ChatMessage object.
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
 * Sanitises a username.
 */
function sanitiseUsername(username: string): string {
  const clean = username.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 64);
  return clean || "unknown_user";
}

/**
 * Generates a reply using conversation context and persistent memory.
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

  while (currentId) {
    const msg = messages.get(currentId);
    if (!msg) break;
    const sanitized = removeAtSymbols(msg.content);
    const content =
      msg.role === "user" && msg.userId
        ? `<@${msg.userId}> asked: ${sanitized}`
        : sanitized;
    context.unshift({ role: msg.role, content });
    currentId = msg.replyToId;
  }

  const memoryEntries = userMemory.get(contextKey) || [];
  const memoryContent = memoryEntries.map((entry) => entry.content).join("\n");
  if (memoryContent) {
    context.unshift({
      role: "system",
      content: `Long-term memory:\n${memoryContent}`,
    });
  }

  const finalMessages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: (await getCharacterDescription(contextKey)).trim(),
      name: undefined,
    },
    ...context.map((msg) => ({
      role: msg.role,
      content: msg.content,
      name: undefined,
    })),
  ];

  console.log("Full prompt context:", JSON.stringify(finalMessages, null, 2));

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
    console.error("Error processing ChatGPT response:", error);
    if (error instanceof APIError && error.code === "insufficient_quota") {
      return `I've reached my limit of wisdom for now. Please pay <@${process.env.OWNER_ID}> money to get more credits.`;
    }
    throw new Error("There was an error processing your request.");
  }
}

/**
 * Summarizes the conversation context.
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

export async function handleNewMessage(openai: OpenAI, client: Client) {
  return async function (message: Message<boolean>): Promise<void> {
    if (message.author.bot) return;
    const userId = message.author.id;
    const contextKey = userId;
    initialiseConversationData(contextKey);

    if (!message.guild) {
      if (message.channel.isTextBased() && "sendTyping" in message.channel) {
        message.channel.sendTyping();
      }
    } else {
      if (
        message.author.id !== cloneUserId &&
        message.mentions.has(client.user?.id ?? "")
      ) {
        if (message.channel.isTextBased() && "sendTyping" in message.channel) {
          message.channel.sendTyping();
        }
      }
    }
    await processMessage(message, contextKey, openai, client);
  };
}

async function processMessage(
  message: Message<boolean>,
  contextKey: string,
  openai: OpenAI,
  client: Client
): Promise<void> {
  if (message.author.id === cloneUserId) {
    await updateCloneMemory(cloneUserId, {
      timestamp: Date.now(),
      content: message.content,
    });
    return;
  }

  const convIds = conversationIdMap.get(contextKey)!;
  const contextId: string = getContextId(message, convIds);
  const guildId = message.guild ? message.guild.id : null;
  const cooldownContext = getCooldownContext(guildId, message.author.id);

  if (useCooldown && isCooldownActive(cooldownContext)) {
    const currentCooldown = defaultCooldownConfig.cooldownTime.toFixed(2);
    const cooldownMsg = await message.reply(
      `You're sending messages too quickly. The server cooldown is set to ${currentCooldown} seconds. Please wait before asking another question.`
    );
    setTimeout(() => {
      cooldownMsg.delete().catch(console.error);
    }, 5000);
    return;
  }

  if (useCooldown) {
    manageCooldown(guildId, message.author.id);
  }

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

  if (conversationContext.messages.size >= CONVERSATION_MESSAGE_LIMIT) {
    const summary = summarizeConversation(conversationContext);
    await updateUserMemory(newMsg.userId!, {
      timestamp: Date.now(),
      content: `Conversation ${contextKey} (asked by <@${newMsg.userId}>): ${summary}`,
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
    const fixedReply = fixMentions(replyContent);
    const sentMessage = await message.reply(fixedReply);

    const botMsg: ChatMessage = createChatMessage(
      sentMessage,
      "assistant",
      client.user?.username ?? "Bot"
    );
    conversationContext.messages.set(sentMessage.id, botMsg);
    convIds.set(sentMessage.id, contextKey);

    const summary = summarizeConversation(conversationContext);
    await updateUserMemory(newMsg.userId!, {
      timestamp: Date.now(),
      content: `Conversation ${contextKey} (asked by <@${newMsg.userId}>): ${summary}`,
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

async function handleError(
  message: Message<boolean>,
  error: unknown
): Promise<void> {
  console.error("Failed to process message:", error);
  await message.reply("An error occurred while processing your request.");
}

function initialiseConversationData(key: string): void {
  if (!conversationHistories.has(key)) {
    conversationHistories.set(key, new Map());
    conversationIdMap.set(key, new Map());
  }
  markContextAsUpdated(key);
}

export async function run(client: Client): Promise<void> {
  try {
    const guildIds: string[] = Array.from(client.guilds.cache.keys());
    await ensureFileExists(guildIds, conversationHistories, conversationIdMap);
  } catch (error: unknown) {
    console.error("Failed to initialise conversations:", error);
    process.exit(1);
  }
}
