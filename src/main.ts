import { Client, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";
import { promises as fs } from "fs";
import { writeFile } from "fs/promises";
import OpenAI, { APIError } from "openai";
import { dirname } from "path";
dotenv.config();

const DATA_FILE = "./conversationHistories.json";

interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  name: string;
  content: string;
  replyToId?: string;
}

interface ConversationContext {
  messages: Map<string, ChatMessage>;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const missingEnvVars = ["BOT_TOKEN", "OPENAI_API_KEY"].filter(
  (key) => !process.env[key]
);
if (missingEnvVars.length > 0) {
  console.error(
    `Missing required environment variable(s): ${missingEnvVars.join(" and ")}. Please provide them in the .env file.`
  );
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

client.once("ready", async () => {
  try {
    await ensureFileExists();
    console.log("Bot is ready.");
  } catch (error) {
    console.error("Failed to initialize conversations:", error);
    process.exit(1); // Exit if the setup fails critically
  }
});

let conversationHistories: Map<string, ConversationContext> = new Map();

const cooldownSet = new Set();
const cooldownTime = 5000;

let conversationIdMap = new Map<string, string>(); // Maps a replyToId to the root conversation ID

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot || !client.user || !message.content) return;

  if (!message.mentions.has(client.user.id)) return;

  if (message.mentions.everyone) {
    await message.reply("i dont care");
    return;
  }

  let contextId: string;

  const replyToId = message.reference?.messageId;
  if (replyToId) {
    if (conversationIdMap.has(replyToId)) {
      contextId = conversationIdMap.get(replyToId)!;
    } else {
      contextId = `${message.channelId}-${message.id}`;
    }
  } else {
    // This is a new conversation initiated without replying to a previous message
    contextId = `${message.channelId}-${message.id}`;
    conversationIdMap.set(message.id, contextId);
  }

  const conversationContext = conversationHistories.get(contextId) || {
    messages: new Map<string, ChatMessage>(),
  };
  conversationHistories.set(contextId, conversationContext);

  if (message.mentions.has(client.user.id)) {
    if (cooldownSet.has(contextId)) {
      await message.reply(
        `Please wait a few more seconds before asking another question.`
      );
      return;
    }

    cooldownSet.add(contextId);
    setTimeout(() => cooldownSet.delete(contextId), cooldownTime);

    const newMessage: ChatMessage = {
      id: message.id,
      role: "user",
      name: sanitizeUsername(message.author.username),
      content: message.content,
      replyToId: replyToId,
    };

    conversationContext.messages.set(message.id, newMessage);
    conversationIdMap.set(message.id, contextId);

    try {
      const replyContent = await generateReply(
        conversationContext.messages,
        message.id
      );
      const sentMessage = await message.reply(replyContent); // This sends the message and returns the sent message object
      const botMessage: ChatMessage = {
        id: sentMessage.id,
        role: "assistant",
        name: "Bot",
        content: replyContent,
        replyToId: message.id, // The bot's message replies to the user's message
      };

      conversationContext.messages.set(sentMessage.id, botMessage);
      conversationIdMap.set(sentMessage.id, contextId);
      await saveConversations();
    } catch (error) {
      console.error("Failed to process message:", error);
      await message.reply(
        "Sorry, I encountered an error while processing your request."
      );
    }
  }
});

function sanitizeUsername(username: string): string {
  const cleanUsername = username
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .substring(0, 64);
  return cleanUsername || "unknown_user"; // Default username if empty
}

async function generateReply(
  messages: Map<string, ChatMessage>,
  currentMessageId: string
): Promise<string> {
  const context = [];
  let currentId: string | undefined = currentMessageId;

  while (currentId && currentId !== "") {
    const message = messages.get(currentId);
    if (message) {
      context.unshift({
        // Prepare the message format as required by OpenAI
        role: message.role,
        content: message.content,
      });
      currentId = message.replyToId; // Continue to the parent message
    } else {
      break; // Stop if there's no parent message or message is undefined
    }
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: context,
    });

    if (!response.choices[0].message.content) {
      return "I'm not sure how to respond to that.";
    }
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error processing ChatGPT response:", error);
    if (error instanceof APIError && error.code === "insufficient_quota") {
      return "I've reached my limit of wisdom for now. Pay Harrison to get more.";
    } else {
      return "There was an error processing your request.";
    }
  }
}

type ConversationMap = Map<string, ConversationContext>;

function mapToObject(map: ConversationMap): {
  [key: string]: { messages: [string, ChatMessage][]; lastMessageId?: string };
} {
  const obj: {
    [key: string]: {
      messages: [string, ChatMessage][];
      lastMessageId?: string;
    };
  } = {};
  for (const [key, context] of map) {
    obj[key] = {
      messages: Array.from(context.messages.entries()),
    };
  }
  return obj;
}

// Convert object back to Map for deserialization
function objectToMap(obj: {
  [key: string]: { messages: [string, ChatMessage][]; lastMessageId?: string };
}): ConversationMap {
  const map = new Map();
  for (const key in obj) {
    const messages = new Map(obj[key].messages);
    map.set(key, { messages });
  }
  return map;
}

async function saveConversations() {
  const conversationData = {
    conversations: mapToObject(conversationHistories),
    idMappings: Array.from(conversationIdMap.entries()),
  };
  await writeFile(
    DATA_FILE,
    JSON.stringify(conversationData, null, 2),
    "utf-8"
  );
}

async function loadConversations() {
  try {
    const data = JSON.parse(await fs.readFile(DATA_FILE, "utf-8"));
    conversationHistories = objectToMap(data.conversations);
    conversationIdMap = new Map(data.idMappings);
    console.log("Loaded conversation data and ID mappings.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("No conversation data found. Initializing new data file.");
    } else {
      console.error("Error loading conversation data:", error);
    }
  }
}

async function ensureFileExists() {
  try {
    await ensureDirectoryExists(DATA_FILE);
    await loadConversations(); // Load or initialize conversations
  } catch (error) {
    console.error("Failed to ensure file existence:", error);
    throw error; // Propagate error up to stop the application if needed
  }
}

async function ensureDirectoryExists(filePath: string) {
  const dir = dirname(filePath);
  try {
    await fs.access(dir);
  } catch (error) {
    // Explicitly type 'error' as 'NodeJS.ErrnoException'
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.mkdir(dir, { recursive: true });
    } else {
      throw error;
    }
  }
}

client.login(process.env.BOT_TOKEN);
