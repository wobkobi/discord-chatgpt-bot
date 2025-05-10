/**
 * @file src/index.ts
 * @description Entry point for initialising and running the Discord bot, including command loading,
 *   registration, event handling, and AI integration.
 * @remarks
 *   Dynamically discovers and registers slash commands, initialises memory stores,
 *   loads per-guild configurations, sets up message and interaction handlers, and manages graceful shutdown.
 *   Includes debug logs via logger.debug for tracing startup steps.
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
import { existsSync, readdirSync } from "fs";
import OpenAI from "openai";
import { join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { loadGuildConfigs } from "./config/index.js";
import { initialiseEnv } from "./utils/env.js";
import logger from "./utils/logger.js";

import { handleNewMessage, run } from "./controllers/messageController.js";
import { initialiseUserMemory } from "./store/userMemory.js";

// Determine environment and command path
const __filename = fileURLToPath(import.meta.url);
const isRunningTS = __filename.endsWith(".ts");
const buildCommandsPath = join(resolve(), "build", "commands");
const commandsPath =
  !isRunningTS && existsSync(buildCommandsPath)
    ? buildCommandsPath
    : join(resolve(), "src", "commands");
const extension = !isRunningTS && existsSync(buildCommandsPath) ? ".js" : ".ts";

logger.info(`🔍 Loading commands from ${commandsPath}`);

/**
 * Structure of a slash-command module.
 */
interface SlashCommandModule {
  /** Slash command builder data. */
  data: SlashCommandBuilder;
  /** Handler for executing the command interaction. */
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

declare module "discord.js" {
  interface Client {
    /** Collection of registered slash commands by name. */
    commands: Collection<string, SlashCommandModule>;
  }
}

let botReady = false;

/**
 * Indicates whether the bot has completed initialisation and is ready to process messages.
 *
 * @returns True if initialisation is complete; false otherwise.
 */
export function isBotReady(): boolean {
  return botReady;
}

(async () => {
  // 1️⃣ Initialise environment variables
  initialiseEnv();

  // 2️⃣ Load per-guild configurations (cooldown + interjectionRate)
  try {
    await loadGuildConfigs();
    logger.info("✅ Guild configurations loaded");
  } catch (err) {
    logger.warn("⚠️ Could not load guild configurations; using defaults", err);
  }

  // 3️⃣ Initialise Discord client
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

  // 4️⃣ Dynamically load slash commands
  const commandFiles = readdirSync(commandsPath).filter((f) =>
    f.endsWith(extension)
  );
  for (const file of commandFiles) {
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
  for (const name of client.commands.keys()) {
    logger.info(`    • ${name}`);
  }

  // 5️⃣ Function to register commands globally
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

  // 6️⃣ Initialise OpenAI client
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  let messageHandler: (message: Message) => Promise<void>;

  // 7️⃣ Set up event listeners
  client.once("ready", async () => {
    logger.info(`🤖 Logged in as ${client.user!.tag}`);

    await registerGlobalCommands();
    await initialiseUserMemory();

    messageHandler = await handleNewMessage(openai, client);
    logger.info("🔄 Message handler initialised.");

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
      const replyOptions = {
        content: "⚠️ There was an error.",
        ephemeral: true,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(replyOptions);
      } else {
        await interaction.reply(replyOptions);
      }
    }
  });

  // 8️⃣ Handle unhandled rejections & graceful shutdown
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection:", reason);
  });
  process.on("SIGINT", () => {
    logger.info("🛑 Shutting down...");
    client.destroy();
    process.exit(0);
  });

  // 9️⃣ Start the bot
  client
    .login(process.env.BOT_TOKEN)
    .then(() => logger.info("🚀 Login successful."))
    .catch((err) => logger.error("❌ Login failed:", err));
})();
