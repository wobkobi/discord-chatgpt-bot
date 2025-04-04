import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import logger from "../utils/logger.js";

/**
 * Slash command data for stopping the bot.
 */
export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Safely stop the bot (Owner only)");

/**
 * Executes the stop command. Only the bot owner can run this command.
 * The command replies with an ephemeral message and then shuts down the bot.
 *
 * @param interaction - The command interaction.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) {
    await interaction.reply({
      content: "Bot owner is not set up.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "Sorry, not allowed.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: "Bot is shutting down...",
    ephemeral: true,
  });
  logger.info("Bot is shutting down by owner command.");
  setTimeout(() => process.exit(0), 1000);
}
