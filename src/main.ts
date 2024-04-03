import { Client, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";
import OpenAI, { APIError } from "openai";

dotenv.config();

interface ChatMessage {
  role: "user" | "assistant" | "system";
  name: string;
  content: string;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const conversationHistories = new Map<
  string,
  { role: string; name: string; content: string }[]
>();

const missingEnvVars = ["BOT_TOKEN", "OPENAI_API_KEY"].filter(
  (key) => !process.env[key]
);
if (missingEnvVars.length > 0) {
  const missingVarsString = missingEnvVars.join(" and ");
  console.error(
    `Missing required environment variable(s): ${missingVarsString}. Please provide them in the .env file.`
  );
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

client.once("ready", () => {
  console.log("Discord bot is ready");
});

const cooldownSet = new Set();
const cooldownTime = 10000;

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot || !client.user || !message.content) return;

  let context: ChatMessage[] = [];

  if (message.mentions.has(client.user.id)) {
    const userId = message.author.id;
    if (cooldownSet.has(userId)) {
      await message.reply("Please wait before asking another question.");
      return;
    }

    if (message.reference && message.reference.messageId) {
      const originalMessage = await message.fetchReference();
      const conversationId =
        originalMessage.author.id === client.user.id
          ? message.author.id
          : originalMessage.author.id;

      // Retrieve existing conversation history, if any
      const existingContext = conversationHistories.get(conversationId) || [];
      context = existingContext.map((msg) => ({
        ...msg,
        name: msg.role === "user" ? "User" : "Bot",
        role: msg.role as "user" | "assistant" | "system",
      }));
    }

    context.push({
      role: "user",
      name: "User",
      content: message.content,
    });
    conversationHistories.set(message.author.id, context);

    cooldownSet.add(userId);
    setTimeout(() => cooldownSet.delete(userId), cooldownTime);

    const query = message.content.replace(/<@!?(\d+)>/g, "").trim();

    if (!query || query === "?") {
      await message.reply("Please provide a more detailed question.");
      return;
    }

    try {
      const chatResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: context,
      });

      if (!chatResponse.choices[0].message.content) {
        await message.reply("I'm not sure how to respond to that.");
        return;
      }
      const gptResponse = chatResponse.choices[0].message.content.trim();
      if (gptResponse) {
        await message.reply(gptResponse);
      } else {
        await message.reply("I'm not sure how to respond to that.");
      }
    } catch (error) {
      console.error("Error processing ChatGPT response:", error);
      if (error instanceof APIError && error.code === "insufficient_quota") {
        await message.reply(
          "I've reached my limit of wisdom for now. Pay Harrison to get more."
        );
      } else {
        await message.reply("There was an error processing your request.");
      }
    }
  }
});

client.login(process.env.BOT_TOKEN);
