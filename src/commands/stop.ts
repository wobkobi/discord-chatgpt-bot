/**
 * @file src/commands/stop.ts
 * @description Slash command to safely shut down the bot (owner only).
 */

import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import logger from "../utils/logger.js";

/**
 * Registration data for the /stop slash command.
 */
export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Safely stop the bot (Owner only)");

/**
 * Handles the /stop command by validating the invoking user as owner,
 * sending a shutdown confirmation, and cleanly destroying the client.
 *
 * @param interaction - The ChatInputCommandInteraction context.
 * @throws When client destruction or process exit fails unexpectedly.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) {
    await interaction.reply({
      content: "⚠️ Bot owner is not configured.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "🚫 You are not allowed to shut me down.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: "🛑 Shutting down. Goodbye!",
    flags: MessageFlags.Ephemeral,
  });

  // Allow Discord to send the reply before destroying the client
  setTimeout(async () => {
    try {
      await interaction.client.destroy();
      logger.info("Discord client destroyed, exiting process.");
    } catch (err) {
      logger.error("Error during client.destroy():", err);
    } finally {
      process.exit(0);
    }
  }, 1000);
}
