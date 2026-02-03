import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags, SlashCommandBuilder } from "discord.js";

/**
 * Slash command definition for stopping the bot (owner only).
 */
export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Safely stop the bot (Owner only)");

/**
 * Executes the /stop command.
 * Only the configured OWNER_ID is allowed to run this command.
 * @param interaction - The interaction that triggered the command.
 * @returns Resolves after responding to the interaction and scheduling process exit.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const ownerId: string | undefined = process.env.OWNER_ID;

  if (!ownerId) {
    await interaction.reply({
      content: "Bot owner is not set up.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "Not allowed.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: "Bot is shutting down...",
    flags: MessageFlags.Ephemeral,
  });

  setTimeout(() => process.exit(0), 1000);
}
