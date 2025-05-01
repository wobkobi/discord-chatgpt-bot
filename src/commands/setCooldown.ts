/**
 * @file src/commands/setcooldown.ts
 * @description Slash command to configure the server’s message cooldown settings (owner-only).
 */

import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import {
  GuildCooldownConfig,
  guildCooldownConfigs,
  saveGuildCooldownConfigs,
} from "../config/index.js";
import logger from "../utils/logger.js";

const OWNER_ID = process.env.OWNER_ID;

/**
 * Registration data for the /setcooldown slash command.
 */
export const data = new SlashCommandBuilder()
  .setName("setcooldown")
  .setDescription("Configure this server’s message cooldown (owner only)")
  .addNumberOption((opt) =>
    opt
      .setName("time")
      .setDescription("Cooldown duration in seconds (0 to disable)")
      .setRequired(true)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("peruser")
      .setDescription("Apply cooldown per user instead of globally")
      .setRequired(false)
  );

/**
 * Handles the /setcooldown command by validating permissions and options,
 * updating the guild’s cooldown configuration, and persisting changes.
 *
 * @param interaction - The interaction context for the command.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  try {
    // Only the bot owner can configure cooldown
    if (!OWNER_ID || interaction.user.id !== OWNER_ID) {
      await interaction.reply({
        content: "🚫 You are not allowed to configure cooldown.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Extract options
    const time = interaction.options.getNumber("time", true);
    const perUser = interaction.options.getBoolean("peruser") ?? false;

    // Must be run in a guild
    const guildId = interaction.guild?.id;
    if (!guildId) {
      await interaction.reply({
        content: "❌ This command can only be used within a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Validate time value
    if (time < 0) {
      await interaction.reply({
        content: "⏱️ Cooldown time must be zero or positive.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Update and persist new configuration
    const newConfig: GuildCooldownConfig = {
      useCooldown: time > 0,
      cooldownTime: time,
      perUserCooldown: perUser,
    };
    guildCooldownConfigs.set(guildId, newConfig);
    await saveGuildCooldownConfigs();

    logger.info(
      `[setcooldown] Updated cooldown for guild ${guildId}: ${JSON.stringify(
        newConfig
      )}`
    );

    await interaction.reply({
      content: `✅ Cooldown updated: **${time}s**, scope: **${
        perUser ? "per user" : "global"
      }**`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    logger.error("[setcooldown] unexpected error:", err);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ An error occurred while updating cooldown.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
