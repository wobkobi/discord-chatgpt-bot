import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Safely stop the bot (Owner only)");

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

  // Give the reply a moment to send before exiting.
  setTimeout(() => process.exit(0), 1000);
}
