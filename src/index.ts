import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import {
  Client,
  Collection,
  GatewayIntentBits,
  Interaction,
  Partials,
} from "discord.js";
import dotenv from "dotenv";
import { readdirSync } from "fs";
import OpenAI from "openai";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { handleNewMessage, run } from "./handlers/createMessage.js";
import { initializeGeneralMemory } from "./memory/generalMemory.js";

dotenv.config();

// Create the Discord client with DM support.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages, // Enables DM reading
  ],
  partials: [Partials.Channel], // Required for DM channels
});

// Extend the client with a commands collection.
client.commands = new Collection();

// Dynamically load command files from the "src/commands" directory.
const commandsPath = join(resolve(), "src", "commands");
const commandFiles = readdirSync(commandsPath).filter(
  (file) => file.endsWith(".js") || file.endsWith(".ts")
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

// Function to register commands globally.
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

// Set up the "ready" event listener.
client.once("ready", async () => {
  console.log("Bot is ready.");
  await registerGlobalCommands(); // Register commands on bot start.
  await initializeGeneralMemory();
  console.log("General memory loaded.");
  await run(client);
});

// Create OpenAI client.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Listen for message events.
client.on("messageCreate", async (message) => {
  // 1. Ignore bot messages
  if (message.author.bot) return;

  // 2. If it's a DM (message.guild is null/undefined), handle it
  if (!message.guild) {
    (await handleNewMessage(openai, client))(message);
    return;
  }

  // 3. In a guild: only respond if the bot is mentioned and not an @everyone or @here
  if (
    !message.mentions.has(client.user?.id ?? "") ||
    message.mentions.everyone
  ) {
    return;
  }

  // If it passes the mention check, handle the message
  (await handleNewMessage(openai, client))(message);
});

// Listen for slash command interactions.
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
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "There was an error executing that command!",
        ephemeral: true,
      });
    }
  }
});

// Log in the bot.
client
  .login(process.env.BOT_TOKEN)
  .then(() => console.log("Bot logged in successfully."))
  .catch((error) => console.error("Failed to log in:", error));
