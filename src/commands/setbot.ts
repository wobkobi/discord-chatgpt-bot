import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getRequired } from "../utils/env.js";
import logger from "../utils/logger.js";

const OWNER_ID = getRequired("OWNER_ID");

/**
 * /setbot
 * @description Change the bot’s username and/or avatar image (Owner only).
 *  Provide one or both of the options:
 * - `name`: New username (≤32 characters)
 * - `avatar`: Image file to set as the new avatar
 */
export const data = new SlashCommandBuilder()
  .setName("setbot")
  .setDescription("Change the bot’s username and/or avatar image (Owner only)")
  .addStringOption((opt) =>
    opt
      .setName("name")
      .setDescription("New username for the bot (max 32 characters)")
      .setRequired(false)
  )
  .addAttachmentOption((opt) =>
    opt
      .setName("avatar")
      .setDescription("Image file to set as the new bot avatar")
      .setRequired(false)
  );

/**
 * Executes the /setbot command.
 * @param interaction – The ChatInputCommandInteraction context.
 * @returns Promise<void>
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;
  if (userId !== OWNER_ID) {
    await interaction.reply({
      content: "🚫 You are not allowed to change my identity.",
      ephemeral: true,
    });
    return;
  }

  const newName = interaction.options.getString("name");
  const attachment = interaction.options.getAttachment("avatar");

  if (!newName && !attachment) {
    await interaction.reply({
      content: "❌ Please provide at least one option: `name` or `avatar`.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const results: string[] = [];

  // Change username if provided
  if (newName) {
    const trimmed = newName.trim();
    if (trimmed.length > 32) {
      results.push("❌ Username must be 32 characters or fewer.");
    } else {
      try {
        await interaction.client.user!.setUsername(trimmed);
        logger.info(
          `[setbot] Username changed to "${trimmed}" by owner ${userId}`
        );
        results.push(`✅ Username updated to **${trimmed}**.`);
      } catch (err) {
        logger.error("[setbot] Failed to set username:", err);
        results.push("⚠️ Failed to update username.");
      }
    }
  }

  // Change avatar if provided
  if (attachment) {
    if (!attachment.contentType?.startsWith("image/")) {
      results.push("❌ Provided file is not a valid image.");
    } else {
      try {
        const res = await fetch(attachment.url);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await interaction.client.user!.setAvatar(buffer);
        logger.info(`[setbot] Avatar updated by owner ${userId}`);
        results.push("✅ Avatar updated successfully.");
      } catch (err) {
        logger.error("[setbot] Failed to set avatar:", err);
        results.push("⚠️ Failed to update avatar.");
      }
    }
  }

  await interaction.editReply({ content: results.join(" \n") });
}
