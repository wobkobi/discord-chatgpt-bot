import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
import OpenAI from "openai";
import { handleNewMessage, run } from "./handlers/createMessage.js";

// Load environment variables
dotenv.config();

// Create the Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Check for required environment variables
const requiredEnvVars = ["BOT_TOKEN", "OPENAI_API_KEY"];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length) {
  console.error(
    `Missing required environment variable(s): ${missingEnvVars.join(", ")}`
  );
  process.exit(1);
}

// Create OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Set up the 'ready' event listener
client.once("ready", () => {
  console.log("Bot is ready.");
  run(client);
});

// Set up the 'messageCreate' event listener
client.on("messageCreate", async (message) => {
  if (message.author.bot) return; // Ignore messages from other bots
  (await handleNewMessage(openai, client))(message);
});

// Log in the bot
client
  .login(process.env.BOT_TOKEN)
  .then(() => {
    console.log("Bot logged in successfully.");
  })
  .catch((error) => {
    console.error("Failed to log in:", error);
  });
