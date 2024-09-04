import { Client, Message } from "discord.js";
import OpenAI, { APIError } from "openai";
import characterDescription from "../data/characterDescription.js";
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
  saveErrorToFile,
} from "../utils/fileUtils.js";

const conversationHistories: Map<
  string,
  Map<string, ConversationContext>
> = new Map();
const conversationIdMap: Map<string, Map<string, string>> = new Map();

export async function handleNewMessage(openai: OpenAI, client: Client) {
  return async function (message: Message<boolean>) {
    if (!message.guild || shouldIgnoreMessage(message, client)) {
      return;
    }

    const guildId = message.guild?.id;

    initialiseGuildData(guildId);

    const channel = message.channel;

    if (channel.isTextBased() && "sendTyping" in channel) {
      channel.sendTyping();
    }

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
    const botName = client.user?.username;
    const botMessage = createChatMessage(sentMessage, "assistant", botName);

    conversationContext.messages.set(sentMessage.id, botMessage);
    guildConversationIds.set(sentMessage.id, contextId);

    await saveConversations(conversationHistories, conversationIdMap);
  } catch (error) {
    handleError(message, error);
  }
}

async function handleError(message: Message<boolean>, error: unknown) {
  console.error("Failed to process message:", error);
  await message.reply(
    "Sorry, I encountered an error while processing your request."
  );
  saveErrorToFile(error);
}

function shouldIgnoreMessage(message: Message, client: Client): boolean {
  return (
    message.author.bot ||
    !client.user ||
    !message.content ||
    message.mentions.everyone ||
    !message.mentions.has(client.user.id)
  );
}

function initialiseGuildData(guildId: string) {
  if (!conversationHistories.has(guildId)) {
    conversationHistories.set(guildId, new Map());
    conversationIdMap.set(guildId, new Map());
  }
  markServerAsUpdated(guildId);
}

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
  return cleanUsername || "unknown_user";
}

async function generateReply(
  messages: Map<string, ChatMessage>,
  currentMessageId: string,
  openai: OpenAI
): Promise<string> {
  const context: { role: "user" | "assistant"; content: string }[] = [];
  let currentId: string | undefined = currentMessageId;

  while (currentId) {
    const message = messages.get(currentId);
    if (!message) break;

    context.unshift({
      role: message.role,
      content: message.content,
    });
    currentId = message.replyToId;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: characterDescription.trim(),
        },
        ...context,
      ],
      top_p: 0.6,
      frequency_penalty: 0.5,
      max_tokens: 2000,
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
    const serverIds = Array.from(client.guilds.cache.keys());
    await ensureFileExists(serverIds, conversationHistories, conversationIdMap);
    console.log("Bot is ready.");
  } catch (error) {
    console.error("Failed to initialise conversations:", error);
    process.exit(1);
  }
}
