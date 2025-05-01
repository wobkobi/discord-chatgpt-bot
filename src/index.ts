/**
 * @file src/index.ts
 * @description Entry point for initializing and running the Discord bot, including command loading, registration, and event handling.
 */

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

// Determine commands directory dynamically
const buildCommandsPath = join(resolve(), "build", "commands");
const isRunningTS = __filename.endsWith(".ts");

const commandsPath =
  !isRunningTS && existsSync(buildCommandsPath)
    ? buildCommandsPath
    : join(resolve(), "src", "commands");

const extension = !isRunningTS && existsSync(buildCommandsPath) ? ".js" : ".ts";

logger.info(`🔍 Loading commands from ${commandsPath}`);

/**
 * Defines the structure of a slash-command module.
 */
interface SlashCommandModule {
  /** Slash command builder data. */
  data: SlashCommandBuilder;
  /** Execute function for handling the interaction. */
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

declare module "discord.js" {
  interface Client {
    /** Collection of registered slash commands. */
    commands: Collection<string, SlashCommandModule>;
  }
}

let botReady = false;

/**
 * Checks if the bot has finished initialization and is ready.
 *
 * @returns True if ready, false otherwise.
 */
export function isBotReady(): boolean {
  return botReady;
}

/**
 * Discord client with specified intents and partials.
 */
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

// Dynamically import and register each command, awaiting all before proceeding
(async () => {
  const files = readdirSync(commandsPath).filter((f) => f.endsWith(extension));
  await Promise.all(
    files.map(async (file) => {
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
    })
  );

  logger.info(`✅ Loaded ${client.commands.size} slash command(s):`);
  for (const name of client.commands.keys()) {
    logger.info(`    • ${name}`);
  }
})();

/**
 * Registers all loaded slash commands globally with Discord.
 *
 * @async
 * @throws Will throw if the REST API call fails.
 */
async function registerGlobalCommands(): Promise<void> {
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
    throw err;
  }
}

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Handler placeholder
let messageHandler: (message: Message) => Promise<void>;

// Setup event listeners
client.once("ready", async () => {
  logger.info(`🤖 Logged in as ${client.user!.tag}`);

  await registerGlobalCommands();
  await initialiseUserMemory();

  messageHandler = await handleNewMessage(openai, client);
  logger.info("🔄 Message handler initialized.");

  await run(client);
  botReady = true;
  logger.info("✅ Bot is now ready to handle messages.");
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !botReady) return;
  try {
    await messageHandler(message);
  } catch (err) {
    logger.error("🛑 Error in message handler:", err);
  }
});

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

// Handle global errors and shutdown
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection:", reason);
});
process.on("SIGINT", () => {
  logger.info("🛑 Shutting down...");
  client.destroy();
  process.exit(0);
});

// Start the bot
client
  .login(process.env.BOT_TOKEN)
  .then(() => logger.info("🚀 Login successful."))
  .catch((err) => logger.error("❌ Login failed:", err));
