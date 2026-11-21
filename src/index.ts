// src/index.ts
// Entry point: discovers and registers slash commands, initialises memory stores, loads
// per-guild configurations, sets up message and interaction handlers, and manages
// graceful shutdown.

import { loadGuildConfigs } from "@/config/index";
import { flushConversations, handleNewMessage, run } from "@/controllers/messageController";
import { getOpenAIClient } from "@/services/openaiClient";
import { initialiseCloneMemory } from "@/store/cloneMemory";
import { initialiseUserMemory } from "@/store/userMemory";
import { isBotReady, markBotReady } from "@/utils/botState";
import { getOptional, getRequired } from "@/utils/env";
import logger from "@/utils/logger";
import {
  ChatInputCommandInteraction,
  Client,
  Collection,
  GatewayIntentBits,
  Interaction,
  Message,
  MessageFlags,
  Partials,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

/** Longest a shutdown waits on the conversation flush; Docker kills the container after 10s. */
const SHUTDOWN_FLUSH_TIMEOUT_MS = 5000;

/** Shorter cap after an uncaught exception, since the process state is already suspect. */
const CRASH_FLUSH_TIMEOUT_MS = 2000;

// Determine environment and command path
const BOT_TOKEN = getRequired("BOT_TOKEN");
const __filename = fileURLToPath(import.meta.url);
const isRunningTS = __filename.endsWith(".ts");
const buildCommandsPath = join(resolve(), "build", "commands");
const commandsPath =
  !isRunningTS && existsSync(buildCommandsPath)
    ? buildCommandsPath
    : join(resolve(), "src", "commands");
const extension = !isRunningTS && existsSync(buildCommandsPath) ? ".js" : ".ts";

logger.info(`🔍 Loading commands from ${commandsPath}`);

// Structure of a slash-command module
interface SlashCommandModule {
  // Slash command builder data
  data: SlashCommandBuilder;
  // Handler for executing the command interaction
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

declare module "discord.js" {
  interface Client {
    // Collection of registered slash commands by name
    commands: Collection<string, SlashCommandModule>;
  }
}

/**
 * Flush pending conversation saves, giving up after a deadline so a hung disk cannot
 * block shutdown. Failures are logged, never thrown.
 * @param timeoutMs - Maximum time to wait for the flush.
 * @returns Promise that resolves once the flush finishes or the deadline passes.
 */
async function flushWithTimeout(timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolveDeadline) => {
    timer = setTimeout(() => {
      logger.warn(`[index] Conversation flush did not finish within ${timeoutMs}ms`);
      resolveDeadline();
    }, timeoutMs);
  });
  try {
    await Promise.race([flushConversations(), deadline]);
  } catch (err) {
    logger.error("[index] Failed to flush conversations:", err);
  } finally {
    clearTimeout(timer);
  }
}

void (async () => {
  // The image bakes in GIT_SHA, so a restart that kept the old image can be told apart
  // from one that pulled a new build. Unset when running from a plain checkout.
  const gitSha = getOptional("GIT_SHA");
  logger.info(`🏷️ Build: ${gitSha ? gitSha.slice(0, 12) : "local (no GIT_SHA)"}`);

  // Load per-guild configurations (cooldown + interjectionRate)
  try {
    await loadGuildConfigs();
    logger.info("✅ Guild configurations loaded");
  } catch (err) {
    logger.warn("⚠️ Could not load guild configurations; using defaults", err);
  }

  // Initialise Discord client with required intents and partials
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      // Without this the emoji cache is seeded once at startup and never updated, so emotes
      // added, renamed or deleted while the bot runs resolve to dead IDs.
      GatewayIntentBits.GuildExpressions,
    ],
    partials: [Partials.Channel],
  });
  // Set before login so command registration can use client.rest
  client.rest.setToken(BOT_TOKEN);
  client.commands = new Collection<string, SlashCommandModule>();

  // Dynamically load slash command modules from commandsPath
  const commandFiles = readdirSync(commandsPath).filter((f) => f.endsWith(extension));
  for (const file of commandFiles) {
    try {
      const url = pathToFileURL(join(commandsPath, file)).href;
      const mod = (await import(url)) as Partial<SlashCommandModule>;
      if (mod.data instanceof SlashCommandBuilder && typeof mod.execute === "function") {
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

  /**
   * Register slash commands globally.
   * @returns Promise that resolves when commands are registered.
   */
  async function registerGlobalCommands(): Promise<void> {
    const clientId = getOptional("CLIENT_ID");
    if (!clientId) {
      logger.warn("[index] CLIENT_ID not set; skipping slash-command registration.");
      return;
    }

    const payload = Array.from(client.commands.values()).map((c) => c.data.toJSON());
    try {
      logger.info("🌐 Registering global slash commands...");
      await client.rest.put(Routes.applicationCommands(clientId), { body: payload });
      logger.info("✅ Slash commands registered.");
    } catch (err) {
      logger.error("[index] Failed to register global commands:", err);
      // Don't re-throw; let the bot keep running without commands
    }
  }

  // Built before login so a missing OPENAI_API_KEY fails at startup, not on the first message
  const openai = getOpenAIClient();

  let messageHandler: (message: Message) => Promise<void>;

  // Set up event listeners for client readiness, messages, and interactions
  client.once("clientReady", async () => {
    logger.info(`🤖 Logged in as ${client.user!.tag}`);

    await registerGlobalCommands();
    initialiseUserMemory();
    initialiseCloneMemory();

    messageHandler = handleNewMessage(openai, client);
    logger.info("🔄 Message handler initialised.");

    await run(client);
    markBotReady();
    logger.info("✅ Bot is now ready to handle messages.");
  });

  // Bot messages are passed through: the handler uses them to reset the interjection count
  client.on("messageCreate", async (message) => {
    if (!isBotReady()) return;
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
      await command.execute(interaction);
    } catch (err) {
      logger.error(`🛑 Error executing /${interaction.commandName}:`, err);
      const replyOptions = {
        content: "⚠️ There was an error.",
        flags: MessageFlags.Ephemeral,
      } as const;
      // The interaction may have expired or already been answered; a failed error reply
      // must not escape as an unhandled rejection.
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(replyOptions);
        } else {
          await interaction.reply(replyOptions);
        }
      } catch (replyErr) {
        logger.error(
          `[index] Failed to send error reply for /${interaction.commandName}:`,
          replyErr,
        );
      }
    }
  });

  let shuttingDown = false;

  /**
   * Flush conversations, destroy the client and exit. Runs at most once: a second signal
   * or a crash during shutdown leaves the first run to finish.
   * @param exitCode - Process exit code.
   * @param flushTimeoutMs - Maximum time to wait for the conversation flush.
   * @returns Promise that resolves early when a shutdown is already under way; otherwise the process exits first.
   */
  async function shutdown(exitCode: number, flushTimeoutMs: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    await flushWithTimeout(flushTimeoutMs);
    try {
      await client.destroy();
    } catch (err) {
      logger.error("[index] Error during client.destroy():", err);
    }
    process.exit(exitCode);
  }

  // Rejections are logged only. An uncaught exception leaves the process in an unknown
  // state, so exit non-zero and let Docker's restart policy bring up a clean one.
  // `docker stop` sends SIGTERM, and as PID 1 with no handler Node would ignore it until
  // Docker kills it after 10 seconds.
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception, exiting:", err);
    void shutdown(1, CRASH_FLUSH_TIMEOUT_MS);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logger.info(`🛑 ${signal} received, shutting down...`);
      void shutdown(0, SHUTDOWN_FLUSH_TIMEOUT_MS);
    });
  }

  // Start the bot by logging in
  client
    .login(BOT_TOKEN)
    .then(() => logger.info("🚀 Login successful."))
    .catch((err) => logger.error("❌ Login failed:", err));
})();
