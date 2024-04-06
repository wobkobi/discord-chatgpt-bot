import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
import OpenAI from "openai";
import { handleNewMessage, run } from "./handlers/createMessage.js";
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const requiredEnvVars = ["BOT_TOKEN", "OPENAI_API_KEY"];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length) {
  console.error(
    `Missing required environment variable(s): ${missingEnvVars.join(", ")}. Please provide them in the .env file.`
  );
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

client.once("ready", () => {
  run(client);
});

client.on("messageCreate", async (message) =>
  (await handleNewMessage(openai, client))(message)
);

client.login(process.env.BOT_TOKEN);
