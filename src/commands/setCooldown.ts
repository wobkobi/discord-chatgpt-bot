/**
 * @file src/commands/setcooldown.ts
 * @description Slash command to configure the server's message cooldown settings,
 *   restricted to the bot owner or server administrators.
 */
import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import {
  GuildCooldownConfig,
  guildCooldownConfigs,
  saveGuildCooldownConfigs,
} from "../config/index.js";
import { getRequired } from "../utils/env.js";
import logger from "../utils/logger.js";

const OWNER_ID = getRequired("OWNER_ID");

/**
 * Slash command registration data for /setcooldown.
 * @param time - Cooldown duration in seconds (0 disables cooldown).
 * @param peruser - Whether to apply the cooldown on a per-user basis.
 */
export const data = new SlashCommandBuilder()
  .setName("setcooldown")
  .setDescription(
    "Configure this server’s message cooldown (owner or admin only)"
  )
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
 * Executes the /setcooldown command.
 * Validates permissions, updates the guild's cooldown config, and persists changes.
 * @param interaction - The interaction context for the slash command.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  try {
    const userId = interaction.user.id;
    const isOwner = OWNER_ID === userId;
    const isAdmin = interaction.memberPermissions?.has(
      PermissionsBitField.Flags.Administrator
    );

    // Permission check: only owner or admin may proceed
    if (!isOwner && !isAdmin) {
      await interaction.reply({
        content:
          "🚫 You must be a server admin or the bot owner to configure cooldown.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Retrieve options
    const time = interaction.options.getNumber("time", true);
    const perUser = interaction.options.getBoolean("peruser") ?? false;

    // Ensure command is used in a guild
    const guildId = interaction.guild?.id;
    if (!guildId) {
      await interaction.reply({
        content: "❌ This command can only be used within a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Validate time argument
    if (time < 0) {
      await interaction.reply({
        content: "⏱️ Cooldown time must be zero or positive.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Apply and save new configuration
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

    // Confirm update to user
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
