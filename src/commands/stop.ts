// src/commands/stop.ts

import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import logger from "../utils/logger.js";

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Safely stop the bot (Owner only)");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) {
    await interaction.reply({
      content: "⚠️ Bot owner is not configured.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "🚫 You are not allowed to shut me down.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: "🛑 Shutting down. Goodbye!",
    ephemeral: true,
  });

  // give Discord a moment to send the reply
  setTimeout(async () => {
    try {
      // cleanly destroy the client to close connections
      await interaction.client.destroy();
      logger.info("Discord client destroyed, exiting process.");
    } catch (err) {
      logger.error("Error during client.destroy():", err);
    } finally {
      process.exit(0);
    }
  }, 1000);
}
