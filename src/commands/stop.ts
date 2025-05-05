/**
 * @file src/commands/stop.ts
 * @description Slash command to safely shut down the bot; restricted to the owner only.
 */

import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { getRequired } from "../utils/env.js";
import logger from "../utils/logger.js";

/**
 * Slash command registration data for /stop.
 * @remarks
 *   This command is owner-only and will terminate the bot process after a short delay.
 */
export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Safely stop the bot (Owner only)");

/**
 * Executes the /stop command.
 * Validates that the invoking user is the configured owner, acknowledges shutdown,
 * then cleanly destroys the Discord client and exits the process.
 *
 * @param interaction - The ChatInputCommandInteraction context for this command.
 * @returns A promise that resolves once the shutdown sequence is initiated.
 * @throws Will throw if client destruction or process exit fails.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  logger.debug(`[stop] Command invoked by userId=${interaction.user.id}`);

  const ownerId = getRequired("OWNER_ID");
  logger.debug(`[stop] Loaded ownerId=${ownerId}`);

  // Ensure owner is configured
  if (!ownerId) {
    logger.debug("[stop] No OWNER_ID configured");
    await interaction.reply({
      content: "⚠️ Bot owner is not configured.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Permission check: only the owner may invoke
  if (interaction.user.id !== ownerId) {
    logger.debug(`[stop] Permission denied for userId=${interaction.user.id}`);
    await interaction.reply({
      content: "🚫 You are not allowed to shut me down.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  logger.info(`[stop] Authorized shutdown by ownerId=${ownerId}`);

  // Acknowledge shutdown to the owner
  await interaction.reply({
    content: "🛑 Shutting down. Goodbye!",
    flags: MessageFlags.Ephemeral,
  });
  logger.debug("[stop] Reply sent, scheduling shutdown sequence");

  // Delay to allow Discord to deliver the reply before destroying the client
  setTimeout(async () => {
    logger.debug("[stop] Executing shutdown sequence");
    try {
      // Destroy the Discord client
      await interaction.client.destroy();
      logger.info("[stop] Discord client destroyed, exiting process.");
    } catch (err) {
      logger.error("[stop] Error during client.destroy():", err);
    } finally {
      // Terminate the Node.js process
      process.exit(0);
    }
  }, 1000);
}
