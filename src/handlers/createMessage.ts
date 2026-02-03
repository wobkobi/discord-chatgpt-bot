import type { Client, Message } from "discord.js";
import OpenAI, { APIError } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

import { updateUserMemory, userMemory } from "../memory/userMemory.js";
import { getCharacterDescription } from "../services/characterService.js";
import type {
  ChatMessage,
  ConversationContext,
  GeneralMemoryEntry,
} from "../types/types.js";
import {
  isCooldownActive,
  manageCooldown,
  useCooldown,
} from "../utils/cooldown.js";
import { ensureFileExists, markContextAsUpdated } from "../utils/fileUtils.js";

// Conversation maps keyed by a context key (using the user's ID or composite key).
const conversationHistories: Map<
  string,
  Map<string, ConversationContext>
> = new Map();

const conversationIdMap: Map<string, Map<string, string>> = new Map();

/**
 * Entry point for processing new messages.
 * Uses the user's ID (or a composite key) so persistent memory travels across servers and DMs.
 * @param openai - OpenAI client used to generate chat completions.
 * @param client - Discord client instance (used for bot identity and guild access).
 * @returns Async message handler function to be registered with the Discord client.
 */
export async function handleNewMessage(
  openai: OpenAI,
  client: Client
): Promise<(message: Message<boolean>) => Promise<void>> {
  return async function (message: Message<boolean>): Promise<void> {
    if (message.author.bot) return;

    const userId = message.author.id;
    // Use a composite key if needed; here we use just the user ID for simplicity.
    const contextKey = userId;

    initialiseConversationData(contextKey);

    if (message.channel.isTextBased() && "sendTyping" in message.channel) {
      // Discord.js typing indicator is fire-and-forget; no need to await.
      void message.channel.sendTyping();
    }

    await processMessage(message, contextKey, openai, client);
  };
}

/**
 * Processes an incoming Discord message, updates conversation context, applies cooldown,
 * generates a reply, and persists conversation and memory updates.
 * @param message - The incoming Discord message.
 * @param contextKey - Context key used to store per-user or per-scope conversation data.
 * @param openai - OpenAI client used to generate the reply.
 * @param client - Discord client instance (used for bot username and guild cache).
 * @returns Resolves when processing completes.
 */
async function processMessage(
  message: Message<boolean>,
  contextKey: string,
  openai: OpenAI,
  client: Client
): Promise<void> {
  const convIds = conversationIdMap.get(contextKey);
  if (!convIds) {
    // Defensive: should not happen because initialiseConversationData is called first.
    initialiseConversationData(contextKey);
  }
  const convIdsSafe = conversationIdMap.get(contextKey)!;

  const contextId: string = getContextId(message, convIdsSafe);

  if (useCooldown && isCooldownActive(contextId)) {
    await message.reply(
      "Please wait a few seconds before asking another question."
    );
    return;
  }

  if (useCooldown) {
    manageCooldown(contextId);
  }

  const convHist = conversationHistories.get(contextKey)!;

  const conversationContext: ConversationContext = convHist.get(contextId) ?? {
    messages: new Map<string, ChatMessage>(),
  };

  convHist.set(contextId, conversationContext);
  convIdsSafe.set(message.id, contextId);

  const newMsg: ChatMessage = createChatMessage(
    message,
    "user",
    client.user?.username ?? "Bot"
  );

  conversationContext.messages.set(message.id, newMsg);

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
    convIdsSafe.set(sentMessage.id, contextId);

    const summary = summariseConversation(conversationContext);

    // newMsg.userId is always set for role === "user".
    await updateUserMemory(newMsg.userId!, {
      timestamp: Date.now(),
      content: `Conversation ${contextId} (asked by ${newMsg.name}): ${summary}`,
    });

    // Ensure conversation files exist for this context.
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
 * Logs errors and replies to the user.
 * @param message - The Discord message being processed.
 * @param error - The error thrown during processing.
 * @returns Resolves when the error has been logged and a reply has been sent.
 */
async function handleError(
  message: Message<boolean>,
  error: unknown
): Promise<void> {
  console.error("Failed to process message:", error);
  await message.reply("An error occurred while processing your request.");
}

/**
 * Determines a conversation context ID for threading and persistence.
 * For DMs, the channel ID is used as the conversation context.
 * For guilds, if the message is a reply to a known message, inherit that context ID;
 * otherwise create a new context ID using channel and message IDs.
 * @param message - The Discord message used to determine context.
 * @param convIds - Map of message IDs to conversation context IDs for the current context key.
 * @returns Conversation context ID string.
 */
function getContextId(message: Message, convIds: Map<string, string>): string {
  if (!message.guild) {
    return message.channel.id;
  }

  const replyToId: string | undefined =
    message.reference?.messageId || undefined;

  return replyToId && convIds.has(replyToId)
    ? convIds.get(replyToId)!
    : `${message.channel.id}-${message.id}`;
}

/**
 * Creates a ChatMessage object from a Discord message.
 * @param message - The Discord message to convert.
 * @param role - The role for the chat message ("user" or "assistant").
 * @param botName - Optional bot display name to use for assistant messages.
 * @returns ChatMessage representation of the message.
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
 * Sanitises a username to a safe subset of characters.
 * @param username - Username to sanitise.
 * @returns Sanitised username (max 64 chars), or "unknown_user" if empty.
 */
function sanitiseUsername(username: string): string {
  const clean = username.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 64);
  return clean || "unknown_user";
}

/**
 * Removes "@" symbols to avoid creating accidental mentions in prompts.
 * @param text - Text to sanitise.
 * @returns Text with "@" symbols removed.
 */
function removeAtSymbols(text: string): string {
  return text.replace(/@/g, "");
}

/**
 * Fixes mention formatting by converting "<123>" into "<@123>".
 * @param content - Content which may contain mention placeholders.
 * @returns Content with Discord mention formatting corrected.
 */
function fixMentions(content: string): string {
  return content.replace(/<(\d+)>/g, "<@$1>");
}

/**
 * Generates a reply using OpenAI by building a message context chain and adding long-term memory.
 * @param messages - Map of message IDs to ChatMessage entries for this conversation.
 * @param currentMessageId - The message ID to start from when building the reply chain.
 * @param openai - OpenAI client used to create a chat completion.
 * @param contextKey - Context key used to fetch persistent long-term memory (user scope in this setup).
 * @returns The assistant reply content.
 * @throws {Error} If the OpenAI response is empty or a request error occurs.
 */
async function generateReply(
  messages: Map<string, ChatMessage>,
  currentMessageId: string,
  openai: OpenAI,
  contextKey: string
): Promise<string> {
  const context: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }> = [];

  let currentId: string | undefined = currentMessageId;

  while (currentId) {
    const msg = messages.get(currentId);
    if (!msg) break;

    const sanitised = removeAtSymbols(msg.content);
    const content =
      msg.role === "user"
        ? `${msg.name} (ID: ${msg.userId}) asked: ${sanitised}`
        : sanitised;

    context.unshift({ role: msg.role, content });
    currentId = msg.replyToId;
  }

  // Retrieve persistent user memory from the userMemory map.
  const memoryEntries = userMemory.get(contextKey) ?? [];
  const memoryContent = memoryEntries
    .map((entry: GeneralMemoryEntry) => entry.content)
    .join("\n");

  if (memoryContent) {
    context.unshift({
      role: "system",
      content: `Long-term memory:\n${memoryContent}`,
    });
  }

  const finalMessages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: (await getCharacterDescription()).trim(),
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
      return "I've reached my limit of wisdom for now. Pay Harrison to get more.";
    }

    throw new Error("There was an error processing your request.");
  }
}

/**
 * Summarises the conversation context by concatenating the last few messages.
 * @param context - Conversation context containing message history.
 * @returns A short summary string.
 */
function summariseConversation(context: ConversationContext): string {
  const msgs = Array.from(context.messages.values());
  return msgs
    .slice(-3)
    .map((msg) => msg.content)
    .join(" ");
}

/**
 * Initialises in-memory conversation storage for a given context key.
 * @param key - Context key to initialise (e.g. user ID or composite scope key).
 */
function initialiseConversationData(key: string): void {
  if (!conversationHistories.has(key)) {
    conversationHistories.set(key, new Map<string, ConversationContext>());
    conversationIdMap.set(key, new Map<string, string>());
  }
  markContextAsUpdated(key);
}

/**
 * Loads persisted conversation data for all guilds the bot is currently in.
 * Intended to be called once during startup.
 * @param client - Discord client instance used to enumerate guild IDs.
 * @returns Resolves when initial conversation data has been loaded.
 * @throws {Error} If initialisation fails.
 */
export async function run(client: Client): Promise<void> {
  try {
    const guildIds: string[] = Array.from(client.guilds.cache.keys());
    await ensureFileExists(guildIds, conversationHistories, conversationIdMap);
  } catch (error: unknown) {
    console.error("Failed to initialise conversations:", error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
