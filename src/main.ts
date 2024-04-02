import { Client, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";
import OpenAI, { APIError } from "openai";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.BOT_TOKEN) {
  console.error("Discord bot token is missing");
  process.exit(1);
}

client.once("ready", () => {
  console.log("Discord bot is ready");
});

const cooldownSet = new Set();
const cooldownTime = 30000;

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot || !client.user || !message.content) return;

  if (
    message.mentions.has(client.user.id) &&
    message.content.trim().endsWith("?")
  ) {
    const userId = message.author.id;
    if (cooldownSet.has(userId)) {
      await message.reply("Please wait before asking another question.");
      return;
    }

    cooldownSet.add(userId);
    setTimeout(() => cooldownSet.delete(userId), cooldownTime);

    const query = message.content.replace(/<@!?(\d+)>/g, "").trim();

    // Ensure the query is not just a question mark or empty after removing the mention
    if (!query || query === "?") {
      await message.reply("Please provide a more detailed question.");
      return;
    }

    try {
      const chatResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: query }],
        max_tokens: 150,
      });

      // if chatResponse.choices[0].message.content is empty, it means the model didn't generate a response
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
