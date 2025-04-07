import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import {
  Client,
  Collection,
  GatewayIntentBits,
  Interaction,
  Message,
  Partials,
} from "discord.js";
import dotenv from "dotenv";
import { existsSync, readdirSync } from "fs";
import OpenAI from "openai";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { handleNewMessage, run } from "./handlers/createMessage.js";
import { initializeUserMemory } from "./memory/userMemory.js";
import logger from "./utils/logger.js";

dotenv.config();

// Determine commands folder
const prodCommandsPath = join(resolve(), "build", "commands");
const devCommandsPath = join(resolve(), "src", "commands");
const commandsPath = existsSync(prodCommandsPath)
  ? prodCommandsPath
  : devCommandsPath;
const fileExtension = existsSync(prodCommandsPath) ? ".js" : ".ts";

logger.info(`Loading commands from: ${commandsPath}`);

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();

// Load slash commands
for (const file of readdirSync(commandsPath).filter((f) =>
  f.endsWith(fileExtension)
)) {
  const url = pathToFileURL(join(commandsPath, file)).href;
  const mod = await import(url);
  if (mod.data && mod.execute) {
    client.commands.set(mod.data.name, mod);
  }
}
logger.info(`Loaded ${client.commands.size} slash command(s).`);

// Register global slash commands
async function registerGlobalCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN!);
  const body = Array.from(client.commands.values()).map((c) => c.data.toJSON());
  try {
    logger.info("Registering global slash commands...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
      body,
    });
    logger.info("Slash commands registered.");
  } catch (err) {
    logger.error("Failed to register slash commands:", err);
  }
}

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Forward all non-bot messages to the handler
client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  await (
    await handleNewMessage(openai, client)
  )(message);
});

// Slash command handling
client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (err) {
    logger.error("Command error:", err);
    const reply = { content: "Error executing command.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// Ready
client.once("ready", async () => {
  logger.info("Bot ready.");
  await registerGlobalCommands();
  await initializeUserMemory();
  logger.info("Memory initialized.");
  await run(client);
});

// Login
client
  .login(process.env.BOT_TOKEN)
  .then(() => logger.info("Logged in."))
  .catch((err) => logger.error("Login failed:", err));
