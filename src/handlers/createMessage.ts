import { Client, Message } from "discord.js";
import OpenAI, { APIError } from "openai";
import ChatMessage from "../types/chatMessage.js";
import ConversationContext from "../types/conversationContext.js";
import {
  ensureFileExists,
  markServerAsUpdated,
  saveConversations,
} from "../utils/file.js";

const cooldownSet = new Set();
const cooldownTime = 5000;

const conversationHistories: Map<
  string,
  Map<string, ConversationContext>
> = new Map();
const conversationIdMap: Map<string, Map<string, string>> = new Map();

export async function handleNewMessage(openai: OpenAI, client: Client) {
  return async function (message: Message<boolean>) {
    if (!message.guild || shouldIgnoreMessage(message, client)) {
      if (message.mentions.everyone) {
        await message.reply("I don't care");
      }
      return;
    }

    const guildId = message.guild?.id;

    initialiseGuildData(guildId);

    const channel = message.channel;

    channel.sendTyping();

    processMessage(client, message, guildId, openai);
  };
}

async function processMessage(
  client: Client,
  message: Message<boolean>,
  guildId: string,
  openai: OpenAI
) {
  const contextId = getContextId(message, conversationIdMap.get(guildId)!);

  if (cooldownSet.has(contextId)) {
    await message.reply(
      "Please wait a few seconds before asking another question."
    );
    return;
  }

  manageCooldown(contextId);

  const guildConversations = conversationHistories.get(guildId)!;
  const guildConversationIds = conversationIdMap.get(guildId)!;

  const conversationContext = guildConversations.get(contextId) || {
    messages: new Map(),
  };

  guildConversations.set(contextId, conversationContext);

  const newMessage = createChatMessage(message, "user", client.user?.username);

  conversationContext.messages.set(message.id, newMessage);
  guildConversationIds.set(message.id, contextId);

  try {
    const replyContent = await generateReply(
      conversationContext.messages,
      message.id,
      openai
    );
    const sentMessage = await message.reply(replyContent);
    // get bot name from client
    const botName = client.user?.username;
    const botMessage = createChatMessage(sentMessage, "assistant", botName);

    conversationContext.messages.set(sentMessage.id, botMessage);
    guildConversationIds.set(sentMessage.id, contextId);

    await saveConversations(conversationHistories, conversationIdMap);
  } catch (error) {
    handleError(message, error);
  }
}

function manageCooldown(contextId: string) {
  cooldownSet.add(contextId);
  setTimeout(() => cooldownSet.delete(contextId), cooldownTime);
}

async function handleError(message: Message<boolean>, error: unknown) {
  console.error("Failed to process message:", error);
  await message.reply(
    "Sorry, I encountered an error while processing your request."
  );
}

function shouldIgnoreMessage(message: Message, client: Client): boolean {
  // Check if the message is from a bot, lacks content, mentions everyone, or doesn't mention the bot specifically
  return (
    message.author.bot || // Message is from another bot
    !client.user || // Bot client user isn't correctly initialised
    !message.content || // Message has no content
    message.mentions.everyone || // Message mentions everyone (@everyone or @here)
    !message.mentions.has(client.user.id) // Message does not specifically mention this bot
  );
}

function initialiseGuildData(guildId: string) {
  if (!conversationHistories.has(guildId)) {
    conversationHistories.set(guildId, new Map());
    conversationIdMap.set(guildId, new Map());
  }
  markServerAsUpdated(guildId);
}

//
function getContextId(
  message: Message,
  conversationIdMap: Map<string, string>
): string {
  const replyToId = message.reference?.messageId;
  return replyToId && conversationIdMap.has(replyToId)
    ? conversationIdMap.get(replyToId)!
    : `${message.channelId}-${message.id}`;
}

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
        : botName || "Bot",
    content: message.content,
    replyToId: message.reference?.messageId,
  };
}

function sanitiseUsername(username: string): string {
  const cleanUsername = username
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .substring(0, 64);
  return cleanUsername || "unknown_user"; // Default username if empty
}

async function generateReply(
  messages: Map<string, ChatMessage>,
  currentMessageId: string,
  openai: OpenAI
): Promise<string> {
  const context: { role: "user" | "assistant"; content: string }[] = []; // Explicitly declare the type of context array
  let currentId: string | undefined = currentMessageId; // Now explicitly allowing undefined

  while (currentId) {
    const message = messages.get(currentId);
    if (!message) break;

    context.unshift({
      role: message.role,
      content: message.content,
    });
    currentId = message.replyToId; // It's fine for currentId to be undefined
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: context,
      top_p: 0.6,
      frequency_penalty: 0.5,
    });

    const replyContent = response.choices[0]?.message.content;
    if (!replyContent) {
      throw new Error("Received an empty response from the AI.");
    }
    return replyContent.trim();
  } catch (error) {
    console.error("Error processing ChatGPT response:", error);
    if (error instanceof APIError && error.code === "insufficient_quota") {
      return "I've reached my limit of wisdom for now. Pay Harrison to get more.";
    }
    throw new Error("There was an error processing your request.");
  }
}

export async function run(client: Client) {
  try {
    // Retrieve list of server IDs from the client guilds if dynamically determining
    const serverIds = Array.from(client.guilds.cache.keys());

    // Ensure files and directories exist for each server
    await ensureFileExists(serverIds, conversationHistories, conversationIdMap);

    console.log("Bot is ready.");
  } catch (error) {
    console.error("Failed to initialise conversations:", error);
    process.exit(1); // Exit if the setup fails critically
  }
}
