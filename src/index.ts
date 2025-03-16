import { REST } from "@discordjs/rest";
import { MessageFlags, Routes } from "discord-api-types/v10";
import {
  Client,
  Collection,
  GatewayIntentBits,
  Interaction,
  Partials,
} from "discord.js";
import dotenv from "dotenv";
import { existsSync, readdirSync } from "fs";
import OpenAI from "openai";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { cloneUserId } from "./data/characterDescription.js";
import { handleNewMessage, run } from "./handlers/createMessage.js";
import { initializeGeneralMemory } from "./memory/generalMemory.js";
import { initializeUserMemory } from "./memory/userMemory.js";

dotenv.config();

const prodCommandsPath = join(resolve(), "build", "commands");
const devCommandsPath = join(resolve(), "src", "commands");
const commandsPath = existsSync(prodCommandsPath)
  ? prodCommandsPath
  : devCommandsPath;
const fileExtension = existsSync(prodCommandsPath) ? ".js" : ".ts";

console.log(`Loading commands from: ${commandsPath}`);

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

const commandFiles = readdirSync(commandsPath).filter((file) =>
  file.endsWith(fileExtension)
);
for (const file of commandFiles) {
  const filePath = join(commandsPath, file);
  const fileUrl = pathToFileURL(filePath).href;
  const commandModule = await import(fileUrl);
  if (commandModule.data && commandModule.execute) {
    client.commands.set(commandModule.data.name, commandModule);
  }
}
console.log(`Loaded ${client.commands.size} slash command(s).`);

async function registerGlobalCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN!);
  const commandData = Array.from(client.commands.values()).map((cmd) =>
    cmd.data.toJSON()
  );
  try {
    console.log("Registering global slash commands...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
      body: commandData,
    });
    console.log("Global slash commands registered.");
  } catch (error) {
    console.error("Failed to register global commands:", error);
  }
}

client.once("ready", async () => {
  console.log("Bot is ready.");
  await registerGlobalCommands();
  await initializeGeneralMemory();
  await initializeUserMemory();
  console.log("Memory initialized.");
  await run(client);
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Process direct messages
  if (!message.guild) {
    (await handleNewMessage(openai, client))(message);
    return;
  }
  // Process messages from the clone user
  if (message.author.id === cloneUserId) {
    (await handleNewMessage(openai, client))(message);
    return;
  }
  // Process guild messages only when the bot is mentioned (and not for @everyone)
  if (
    !message.mentions.has(client.user?.id ?? "") ||
    message.mentions.everyone
  ) {
    return;
  }
  (await handleNewMessage(openai, client))(message);
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (error: unknown) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error executing that command!",
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: "There was an error executing that command!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

client
  .login(process.env.BOT_TOKEN)
  .then(() => console.log("Bot logged in successfully."))
  .catch((error) => console.error("Failed to log in:", error));
