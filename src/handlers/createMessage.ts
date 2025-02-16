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

// Conversation maps keyed by a "server" ID.
// For DMs, we use a pseudo-guild ID (e.g. "dm-<userID>").
const conversationHistories: Map<
  string,
  Map<string, ConversationContext>
> = new Map();
const conversationIdMap: Map<string, Map<string, string>> = new Map();

/**
 * Main entry point for processing new messages.
 * If a message is sent in a DM (i.e. message.guild is falsy), then process it with handleDirectMessage.
 * Otherwise, process it as a guild message.
 */
export async function handleNewMessage(openai: OpenAI, client: Client) {
  return async function (message: Message<boolean>): Promise<void> {
    if (message.author.bot) return;

    if (!message.guild) {
      // DM: process directly
      await handleDirectMessage(message, openai, client);
      return;
    }

    // Guild message processing:
    const guildId: string = message.guild.id;
    initialiseConversationData(guildId);

    if (message.channel.isTextBased() && "sendTyping" in message.channel) {
      message.channel.sendTyping();
    }
    await processMessage(message, guildId, openai, client);
  };
}

/**
 * Process a guild message.
 */
async function processMessage(
  message: Message<boolean>,
  guildId: string,
  openai: OpenAI,
  client: Client
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
    const fixedReplyContent = fixMentions(replyContent);
    const sentMessage = await message.reply(fixedReplyContent);
    const botMessage: ChatMessage = createChatMessage(
      sentMessage,
      "assistant",
      client.user?.username ?? "Bot"
    );
    conversationContext.messages.set(sentMessage.id, botMessage);
    guildConversationIds.set(sentMessage.id, contextId);

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
 * Process a DM message.
 * Uses a pseudo-guild ID ("dm-<userID>") so that DM conversations are stored separately.
 */
async function handleDirectMessage(
  message: Message<boolean>,
  openai: OpenAI,
  client: Client
): Promise<void> {
  const dmGuildId = `dm-${message.author.id}`;
  initialiseConversationData(dmGuildId);

  const dmConversationIds = conversationIdMap.get(dmGuildId)!;
  const contextId: string = `${message.channel.id}-${message.id}`;
  dmConversationIds.set(message.id, contextId);

  const dmConversations = conversationHistories.get(dmGuildId)!;
  const conversationContext: ConversationContext = dmConversations.get(
    contextId
  ) || { messages: new Map<string, ChatMessage>() };

  dmConversations.set(contextId, conversationContext);

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
      dmGuildId
    );
    const fixedReplyContent = fixMentions(replyContent);
    const sentMessage = await message.reply(fixedReplyContent);
    const botMessage: ChatMessage = createChatMessage(
      sentMessage,
      "assistant",
      client.user?.username ?? "Bot"
    );
    conversationContext.messages.set(sentMessage.id, botMessage);
    dmConversationIds.set(sentMessage.id, contextId);

    const summary = summarizeConversation(conversationContext);
    const memoryEntry = {
      timestamp: Date.now(),
      content: `DM Conversation ${contextId} (asked by ${newMessage.name} [${newMessage.userId}]): ${summary}`,
    };
    await updateGeneralMemory(dmGuildId, memoryEntry);
    await saveConversations(conversationHistories, conversationIdMap);
  } catch (error: unknown) {
    await handleError(message, error);
  }
}

/**
 * Logs errors and replies to the user.
 */
async function handleError(
  message: Message<boolean>,
  error: unknown
): Promise<void> {
  console.error("Failed to process message:", error);
  await message.reply("An error occurred while processing your request.");
}

/**
 * Determines a conversation context ID.
 */
function getContextId(
  message: Message,
  conversationIds: Map<string, string>
): string {
  const replyToId: string | undefined =
    message.reference?.messageId || undefined;
  return replyToId && conversationIds.has(replyToId)
    ? conversationIds.get(replyToId)!
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
    replyToId: message.reference?.messageId || undefined,
  };
}

/**
 * Sanitises a username.
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
  return content.replace(/<(\d+)>/g, "<@$1>");
}

/**
 * Generates a reply using OpenAI.
 */
async function generateReply(
  messages: Map<string, ChatMessage>,
  currentMessageId: string,
  openai: OpenAI,
  contextId: string
): Promise<string> {
  const context: { role: "user" | "assistant" | "system"; content: string }[] =
    [];
  let currentId: string | undefined = currentMessageId;

  while (currentId) {
    const msg = messages.get(currentId);
    if (!msg) break;
    const sanitizedContent = removeAtSymbols(msg.content);
    const content =
      msg.role === "user"
        ? `${msg.name} (ID: ${msg.userId}) asked: ${sanitizedContent}`
        : removeAtSymbols(msg.content);
    context.unshift({ role: msg.role, content });
    currentId = msg.replyToId;
  }

  const memoryEntries = generalMemory.get(contextId) || [];
  const memoryContent = memoryEntries.map((entry) => entry.content).join("\n");
  if (memoryContent) {
    context.unshift({
      role: "system",
      content: `Long-term memory:\n${memoryContent}`,
    });
  }

  // Build the final messages array using ChatCompletionMessageParam.
  const finalMessages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: getCharacterDescription().trim(),
      name: undefined,
    },
    ...context.map((msg) => ({
      role: msg.role as "user" | "assistant" | "system",
      content: msg.content,
      name: undefined,
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
  const msgs = Array.from(context.messages.values());
  return msgs
    .slice(-3)
    .map((msg) => msg.content)
    .join(" ");
}

/**
 * Initializes conversation storage for a given ID.
 */
function initialiseConversationData(id: string): void {
  if (!conversationHistories.has(id)) {
    conversationHistories.set(id, new Map());
    conversationIdMap.set(id, new Map());
  }
  markServerAsUpdated(id);
}

/**
 * Exposes a run function for startup initialization.
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
