import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getRequired } from "../utils/env.js";
import logger from "../utils/logger.js";

const OWNER_ID = getRequired("OWNER_ID");

/**
 * /setavatar
 * @description Change the bot’s avatar image (Owner only).
 *  Only the application owner may run this. Pass an image file as the “avatar” option.
 */
export const data = new SlashCommandBuilder()
  .setName("setavatar")
  .setDescription("Set the bot’s avatar image (Owner only)")
  .addAttachmentOption((opt) =>
    opt
      .setName("avatar")
      .setDescription("Image file to set as the new bot avatar")
      .setRequired(true)
  );

/**
 * Executes the /setavatar command.
 * @param interaction – The ChatInputCommandInteraction context.
 * @returns Promise<void>
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;
  if (userId !== OWNER_ID) {
    await interaction.reply({
      content: "🚫 You are not allowed to change my avatar.",
      ephemeral: true,
    });
    return;
  }

  const attachment = interaction.options.getAttachment("avatar", true);
  if (!attachment.contentType?.startsWith("image/")) {
    await interaction.reply({
      content: "❌ Please provide a valid image file.",
      ephemeral: true,
    });
    return;
  }

  // Defer an ephemeral reply to give time for fetching and updating
  await interaction.deferReply({ ephemeral: true });
  try {
    // Node 18+ has global fetch; otherwise install node-fetch
    const res = await fetch(attachment.url);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await interaction.client.user!.setAvatar(buffer);
    logger.info(
      `[setavatar] Bot avatar updated successfully by owner ${userId}`
    );

    // Edit the deferred reply; no ephemeral flag needed here
    await interaction.editReply({ content: "✅ Avatar updated successfully." });
  } catch (err) {
    logger.error("[setavatar] Failed to set avatar:", err);
    // Edit the deferred reply; no ephemeral flag needed here
    await interaction.editReply({
      content: "⚠️ Something went wrong while updating my avatar.",
    });
  }
}
