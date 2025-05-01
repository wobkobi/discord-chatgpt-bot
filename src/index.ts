// src/index.ts

import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import {
  ChatInputCommandInteraction,
  Client,
  Collection,
  GatewayIntentBits,
  Interaction,
  Message,
  Partials,
  SlashCommandBuilder,
} from "discord.js";
import dotenv from "dotenv";
import { existsSync, readdirSync } from "fs";
import OpenAI from "openai";
import { join, resolve } from "path";
import { pathToFileURL } from "url";

import { handleNewMessage, run } from "./controllers/messageController.js";
import { initialiseUserMemory } from "./store/userMemory.js";
import logger from "./utils/logger.js";

dotenv.config();

// Determine where our built vs. src commands live
const isProd = existsSync(join(resolve(), "build", "commands"));
const commandsPath = isProd
  ? join(resolve(), "build", "commands")
  : join(resolve(), "src", "commands");
const extension = isProd ? ".js" : ".ts";

logger.info(`🔍 Loading commands from ${commandsPath}`);

// Define the exact shape of our slash‐command modules
interface SlashCommandModule {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

declare module "discord.js" {
  interface Client {
    commands: Collection<string, SlashCommandModule>;
  }
}

let botReady = false;
export function isBotReady() {
  return botReady;
}
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection<string, SlashCommandModule>();

// Dynamically import each command file and register it
for (const file of readdirSync(commandsPath).filter((f) =>
  f.endsWith(extension)
)) {
  try {
    const url = pathToFileURL(join(commandsPath, file)).href;
    const mod = (await import(url)) as Partial<SlashCommandModule>;
    if (
      mod.data instanceof SlashCommandBuilder &&
      typeof mod.execute === "function"
    ) {
      client.commands.set(mod.data.name, {
        data: mod.data,
        execute: mod.execute,
      });
    } else {
      logger.warn(`⚠️ ${file} does not export a valid SlashCommandModule.`);
    }
  } catch (err) {
    logger.error(`❌ Failed to load ${file}:`, err);
  }
}
logger.info(`✅ Loaded ${client.commands.size} slash command(s):`);
for (const commandName of client.commands.keys()) {
  logger.info(`    • ${commandName}`);
}

// Register slash commands globally
async function registerGlobalCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN!);
  const payload = Array.from(client.commands.values()).map((c) =>
    c.data.toJSON()
  );

  try {
    logger.info("🌐 Registering global slash commands...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
      body: payload,
    });
    logger.info("✅ Slash commands registered.");
  } catch (err) {
    logger.error("❌ Failed to register slash commands:", err);
  }
}

// Initialise OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// We'll build this once on ready
let messageHandler: (message: Message) => Promise<void>;

client.once("ready", async () => {
  logger.info(`🤖 Logged in as ${client.user!.tag}`);

  // Register slash commands & init user memory
  await registerGlobalCommands();
  await initialiseUserMemory();

  // Build our DM/mention handler a single time
  messageHandler = await handleNewMessage(openai, client);
  logger.info("🔄 Message handler initialised.");

  // Preload any existing conversation files
  await run(client);
  botReady = true;
  logger.info("✅ Bot is now ready to handle messages.");
});

// Route every non-bot message into our handler
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!botReady) return;
  try {
    await messageHandler(message);
  } catch (err) {
    logger.error("🛑 Error in message handler:", err);
  }
});

// Slash‐command dispatcher
client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction as ChatInputCommandInteraction);
  } catch (err) {
    logger.error(`🛑 Error executing /${interaction.commandName}:`, err);
    const reply = { content: "⚠️ There was an error.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// Global unhandled‐rejection guard
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection:", reason);
});

// Graceful shutdown on Ctrl+C
process.on("SIGINT", () => {
  logger.info("🛑 Shutting down...");
  client.destroy();
  process.exit(0);
});

// Kick it off
client
  .login(process.env.BOT_TOKEN)
  .then(() => logger.info("🚀 Login successful."))
  .catch((err) => logger.error("❌ Login failed:", err));
