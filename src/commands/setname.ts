// src/commands/setname.ts

import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getRequired } from "../utils/env.js";
import logger from "../utils/logger.js";

const OWNER_ID = getRequired("OWNER_ID");

/**
 * /setname
 * @description Change the bot’s global username (Owner only).
 *  Only the application owner may run this. Username length must be ≤ 32 chars.
 */
export const data = new SlashCommandBuilder()
  .setName("setname")
  .setDescription("Set the bot’s username (Owner only)")
  .addStringOption((opt) =>
    opt
      .setName("name")
      .setDescription("New username for the bot (max 32 characters)")
      .setRequired(true)
  );

/**
 * Executes the /setname command.
 * @param interaction – The ChatInputCommandInteraction context.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;
  if (userId !== OWNER_ID) {
    await interaction.reply({
      content: "🚫 You are not allowed to change my name.",
      ephemeral: true,
    });
    return;
  }

  const newName = interaction.options.getString("name", true).trim();
  if (newName.length > 32) {
    await interaction.reply({
      content: "❌ Name must be 32 characters or fewer.",
      ephemeral: true,
    });
    return;
  }

  try {
    await interaction.client.user!.setUsername(newName);
    logger.info(
      `[setname] Bot username changed to "${newName}" by owner ${userId}`
    );
    await interaction.reply({
      content: `✅ Username updated to **${newName}**.`,
      ephemeral: true,
    });
  } catch (err) {
    logger.error("[setname] Failed to set username:", err);
    await interaction.reply({
      content: "⚠️ Something went wrong while updating my name.",
      ephemeral: true,
    });
  }
}
