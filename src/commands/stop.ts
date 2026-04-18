/**
 * @file src/commands/stop.ts
 * @description Slash command to safely shut down the bot; restricted to the owner only.
 */

import { getRequired } from "@/utils/env.js";
import logger from "@/utils/logger.js";
import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";

/**
 * Slash command registration data for /stop.
 */
export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Safely stop the bot (Owner only)");

/**
 * Executes the /stop command. Validates ownership, acknowledges shutdown,
 * then destroys the Discord client and exits the process after a short delay.
 * @param interaction - The ChatInputCommandInteraction context for this command.
 * @returns A promise that resolves once the shutdown sequence is initiated.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const ownerId = getRequired("OWNER_ID");

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

  logger.info(`[stop] Authorized shutdown by ownerId=${ownerId}`);
  await interaction.reply({ content: "🛑 Shutting down. Goodbye!", flags: MessageFlags.Ephemeral });

  setTimeout(async () => {
    try {
      await interaction.client.destroy();
      logger.info("[stop] Discord client destroyed, exiting process.");
    } catch (err) {
      logger.error("[stop] Error during client.destroy():", err);
    } finally {
      process.exit(0);
    }
  }, 1000);
}
