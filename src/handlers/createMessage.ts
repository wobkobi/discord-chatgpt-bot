import { Client, Message } from "discord.js";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { getCharacterDescription } from "../data/characterDescription.js";
import { generalMemory, updateGeneralMemory } from "../memory/generalMemory.js";
import { ChatMessage, ConversationContext } from "../types/types.js";
import {
  isCooldownActive,
  manageCooldown,
  useCooldown,
} from "../utils/cooldown.js";
import {
  ensureFileExists,
  markServerAsUpdated,
  saveConversations,
} from "../utils/fileUtils.js";

const conversationHistories: Map<
  string,
  Map<string, ConversationContext>
> = new Map();
const conversationIdMap: Map<string, Map<string, string>> = new Map();

/**
 * Sets up a message handler that processes new messages.
 */
export async function handleNewMessage(openai: OpenAI, client: Client) {
  return async function (message: Message<boolean>): Promise<void> {
    if (!message.guild || shouldIgnoreMessage(message, client)) {
      return;
    }

    const guildId: string = message.guild.id;
    initialiseGuildData(guildId);

    const channel = message.channel;
    if (channel.isTextBased() && "sendTyping" in channel) {
      channel.sendTyping();
    }

    processMessage(client, message, guildId, openai);
  };
}

/**
 * Processes a Discord message and handles conversation context.
 */
async function processMessage(
  client: Client,
  message: Message<boolean>,
  guildId: string,
  openai: OpenAI
): Promise<void> {
  const guildConversationIds = conversationIdMap.get(guildId)!;
  const contextId: string = getContextId(message, guildConversationIds);

  if (useCooldown && isCooldownActive(contextId)) {
    await message.reply(
      "Please wait a few seconds before asking another question."
    );
    return;
  }

  if (useCooldown) {
    manageCooldown(contextId);
  }

  const guildConversations = conversationHistories.get(guildId)!;
  const conversationContext: ConversationContext = guildConversations.get(
    contextId
  ) || { messages: new Map<string, ChatMessage>() };

  guildConversations.set(contextId, conversationContext);
  guildConversationIds.set(message.id, contextId);

  // Include the userId so we know who is asking.
  const newMessage: ChatMessage = createChatMessage(
    message,
    "user",
    client.user?.username ?? "Bot"
  );
  conversationContext.messages.set(message.id, newMessage);

  try {
    const replyContent: string = await generateReply(
      conversationContext.messages,
      message.id,
      openai,
      guildId
    );
    // Fix any mention formatting issues before sending the reply.
    const fixedReplyContent = fixMentions(replyContent);
    const sentMessage = await message.reply(fixedReplyContent);
    const botName = client.user?.username ?? "Bot";
    const botMessage: ChatMessage = createChatMessage(
      sentMessage,
      "assistant",
      botName
    );
    conversationContext.messages.set(sentMessage.id, botMessage);
    guildConversationIds.set(sentMessage.id, contextId);

    // Update general memory with a summary including who asked.
    const summary = summarizeConversation(conversationContext);
    const memoryEntry = {
      timestamp: Date.now(),
      content: `Conversation ${contextId} (asked by ${newMessage.name} [${newMessage.userId}]): ${summary}`,
    };
    await updateGeneralMemory(guildId, memoryEntry);

    await saveConversations(conversationHistories, conversationIdMap);
  } catch (error: unknown) {
    await handleError(message, error);
  }
}

/**
 * Logs errors and notifies the user.
 */
async function handleError(
  message: Message<boolean>,
  error: unknown
): Promise<void> {
  console.error("Failed to process message:", error);
  await message.reply("An error occurred while processing your request.");
}

/**
 * Checks if a message should be ignored.
 */
function shouldIgnoreMessage(message: Message, client: Client): boolean {
  return (
    message.author.bot ||
    !client.user ||
    !message.content ||
    message.mentions.everyone ||
    !message.mentions.has(client.user.id)
  );
}

/**
 * Initializes conversation storage for a guild.
 */
function initialiseGuildData(guildId: string): void {
  if (!conversationHistories.has(guildId)) {
    conversationHistories.set(guildId, new Map());
    conversationIdMap.set(guildId, new Map());
  }
  markServerAsUpdated(guildId);
}

/**
 * Determines the context id for a message based on its reference.
 */
function getContextId(
  message: Message,
  guildConversationIds: Map<string, string>
): string {
  const replyToId: string | undefined =
    message.reference?.messageId ?? undefined;
  return replyToId && guildConversationIds.has(replyToId)
    ? guildConversationIds.get(replyToId)!
    : `${message.channelId}-${message.id}`;
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
    // For user messages, include the author's username and id.
    name:
      role === "user"
        ? sanitiseUsername(message.author.username)
        : (botName ?? "Bot"),
    userId: role === "user" ? message.author.id : undefined,
    content: message.content,
    replyToId: message.reference?.messageId ?? undefined,
  };
}

/**
 * Sanitizes a username.
 */
function sanitiseUsername(username: string): string {
  const cleanUsername = username
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .substring(0, 64);
  return cleanUsername || "unknown_user";
}

/**
 * Removes "@" symbols from text.
 */
function removeAtSymbols(text: string): string {
  return text.replace(/@/g, "");
}

/**
 * Fixes mention formatting.
 */
function fixMentions(content: string): string {
  return content.replace(/<(?!!@)(\d+)>/g, "<@$1>");
}

/**
 * Generates a reply from OpenAI using both conversation context and general memory.
 */
async function generateReply(
  messages: Map<string, ChatMessage>,
  currentMessageId: string,
  openai: OpenAI,
  guildId: string
): Promise<string> {
  const context: { role: "user" | "assistant" | "system"; content: string }[] =
    [];
  let currentId: string | undefined = currentMessageId;

  // Traverse the conversation thread backwards.
  while (currentId) {
    const message = messages.get(currentId);
    if (!message) break;

    const sanitizedContent = removeAtSymbols(message.content);
    const content =
      message.role === "user"
        ? `${message.name} (ID: ${message.userId}) asked: ${sanitizedContent}`
        : removeAtSymbols(message.content);

    context.unshift({
      role: message.role,
      content,
    });
    currentId = message.replyToId;
  }

  // Incorporate general memory from the guild, if available.
  const generalMemoryEntries = generalMemory.get(guildId) || [];
  const memoryContent = generalMemoryEntries
    .map((entry) => entry.content)
    .join("\n");
  if (memoryContent) {
    context.unshift({
      role: "system",
      content: `Long-term memory:\n${memoryContent}`,
    });
  }

  // Build the final prompt context with the character description.
  const finalMessages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: getCharacterDescription().trim(),
    },
    ...context.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
  ];

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
      return "I've reached my limit of wisdom for now. Pay Harrison to get more.";
    }
    throw new Error("There was an error processing your request.");
  }
}

/**
 * Summarizes the conversation context (simple implementation).
 */
function summarizeConversation(context: ConversationContext): string {
  const messages = Array.from(context.messages.values());
  return messages
    .slice(-3)
    .map((msg) => msg.content)
    .join(" ");
}

/**
 * Initializes server data on bot startup.
 */
export async function run(client: Client): Promise<void> {
  try {
    const serverIds: string[] = Array.from(client.guilds.cache.keys());
    await ensureFileExists(serverIds, conversationHistories, conversationIdMap);
  } catch (error: unknown) {
    console.error("Failed to initialise conversations:", error);
    process.exit(1);
  }
}
