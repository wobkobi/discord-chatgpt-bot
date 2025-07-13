import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getRequired } from "../utils/env.js";
import logger from "../utils/logger.js";

const OWNER_ID = getRequired("OWNER_ID");
const BOT_TOKEN = getRequired("BOT_TOKEN");

/**
 * /setbot
 * @description Change the bot’s username and/or avatar image (Owner only).
 * Provide one or both of the options:
 *  `name`: New username (max 32 chars)
 *  `avatar`: Image file to set as the new bot avatar
 */
export const data = new SlashCommandBuilder()
  .setName("setbot")
  .setDescription("Change the bot’s username and/or avatar image (Owner only)")
  .addStringOption((opt) =>
    opt
      .setName("name")
      .setDescription("New username (max 32 characters)")
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

  // Only the configured owner can run this
  if (userId !== OWNER_ID) {
    await interaction.reply({
      content: "🚫 You are not allowed to change my identity.",
      ephemeral: true,
    });
    return;
  }

  // Ensure REST has valid token for patch requests
  interaction.client.rest.setToken(BOT_TOKEN);

  const newName = interaction.options.getString("name");
  const avatarAttachment = interaction.options.getAttachment("avatar");

  if (!newName && !avatarAttachment) {
    await interaction.reply({
      content: "❌ Provide at least one option: `name` or `avatar`.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const editPayload: { username?: string; avatar?: Buffer } = {};

  // Prepare username change
  if (newName) {
    const trimmed = newName.trim();
    if (trimmed.length > 32) {
      await interaction.editReply({
        content: "❌ Username must be 32 characters or fewer.",
      });
      return;
    }
    editPayload.username = trimmed;
  }

  // Prepare avatar change
  if (avatarAttachment) {
    if (!avatarAttachment.contentType?.startsWith("image/")) {
      await interaction.editReply({
        content: "❌ Provided file is not a valid image.",
      });
      return;
    }
    try {
      const res = await fetch(avatarAttachment.url);
      const arrayBuffer = await res.arrayBuffer();
      editPayload.avatar = Buffer.from(arrayBuffer);
    } catch (err) {
      logger.error("[setbot] Failed to fetch avatar image:", err);
      await interaction.editReply({
        content: "⚠️ Could not download the avatar image.",
      });
      return;
    }
  }

  // Execute a single edit request
  try {
    await interaction.client.user!.edit(editPayload);
    logger.info(`[setbot] Identity updated by owner ${userId}`);
    const messages: string[] = [];
    if (editPayload.username)
      messages.push(`✅ Username updated to **${editPayload.username}**.`);
    if (editPayload.avatar) messages.push("✅ Avatar updated successfully.");
    await interaction.editReply({ content: messages.join("\n") });
  } catch (err) {
    logger.error("[setbot] Failed to update identity:", err);
    await interaction.editReply({
      content: "⚠️ Something went wrong while updating my identity.",
    });
  }
}
