import { Client, Message } from "discord.js";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { getCharacterDescription } from "../data/characterDescription.js";
import { updateUserMemory, userMemory } from "../memory/userMemory.js";
import { ChatMessage, ConversationContext } from "../types/types.js";
import {
  isCooldownActive,
  manageCooldown,
  useCooldown,
} from "../utils/cooldown.js";
import {
  ensureFileExists,
  markContextAsUpdated,
  saveConversations,
} from "../utils/fileUtils.js";

// Conversation maps keyed by a context key (using the user's ID).
const conversationHistories: Map<
  string,
  Map<string, ConversationContext>
> = new Map();
const conversationIdMap: Map<string, Map<string, string>> = new Map();

/**
 * Entry point for processing new messages.
 * Uses the user's ID as the key so persistent memory travels across servers and DMs.
 */
export async function handleNewMessage(openai: OpenAI, client: Client) {
  return async function (message: Message<boolean>): Promise<void> {
    if (message.author.bot) return;
    const userId = message.author.id;
    const contextKey = userId; // Use user ID as unified context key.
    initialiseConversationData(contextKey);

    if (message.channel.isTextBased() && "sendTyping" in message.channel) {
      message.channel.sendTyping();
    }
    await processMessage(message, contextKey, openai, client);
  };
}

/**
 * Process a message and update conversation context.
 */
async function processMessage(
  message: Message<boolean>,
  contextKey: string,
  openai: OpenAI,
  client: Client
): Promise<void> {
  const convIds = conversationIdMap.get(contextKey)!;
  const contextId: string = getContextId(message, convIds);

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
    convIds.set(sentMessage.id, contextId);

    const summary = summarizeConversation(conversationContext);
    await updateUserMemory(newMsg.userId!, {
      timestamp: Date.now(),
      content: `Conversation ${contextId} (asked by ${newMsg.name}): ${summary}`,
    });
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
function getContextId(message: Message, convIds: Map<string, string>): string {
  const replyToId: string | undefined =
    message.reference?.messageId || undefined;
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
    replyToId: message.reference?.messageId || undefined,
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
      msg.role === "user"
        ? `${msg.name} (ID: ${msg.userId}) asked: ${sanitized}`
        : sanitized;
    context.unshift({ role: msg.role, content });
    currentId = msg.replyToId;
  }

  // Retrieve persistent user memory from the in-memory userMemory map.
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
      content: getCharacterDescription().trim(),
      name: undefined,
    },
    ...context.map((msg) => ({
      role: msg.role as "user" | "assistant" | "system",
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
 * Summarizes the conversation context.
 */
function summarizeConversation(context: ConversationContext): string {
  const msgs = Array.from(context.messages.values());
  return msgs
    .slice(-3)
    .map((msg) => msg.content)
    .join(" ");
}

/**
 * Initializes conversation storage for a given key.
 */
function initialiseConversationData(key: string): void {
  if (!conversationHistories.has(key)) {
    conversationHistories.set(key, new Map());
    conversationIdMap.set(key, new Map());
  }
  markContextAsUpdated(key);
}

/**
 * Exposes a run function for startup initialization.
 */
export async function run(client: Client): Promise<void> {
  try {
    // For guilds, load conversation files using guild IDs.
    const guildIds: string[] = Array.from(client.guilds.cache.keys());
    await ensureFileExists(guildIds, conversationHistories, conversationIdMap);
  } catch (error: unknown) {
    console.error("Failed to initialise conversations:", error);
    process.exit(1);
  }
}
