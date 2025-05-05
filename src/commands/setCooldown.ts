/**
 * @file src/commands/setcooldown.ts
 * @description Slash command to configure this server’s message cooldown settings.
 *   Restricted to the bot owner or server administrators.
 * @remarks
 *   Validates permissions, applies new settings, and persists configuration.
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
 * @param peruser - Whether to apply the cooldown per user rather than globally.
 */
export const data = new SlashCommandBuilder()
  .setName("setcooldown")
  .setDescription("Configure this server’s message cooldown (owner/admin only)")
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
 * @param interaction - The ChatInputCommandInteraction context.
 * @returns Promise that resolves when the reply is sent.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;
  logger.debug(`[setcooldown] Invoked by userId=${userId}`);

  try {
    const isOwner = OWNER_ID === userId;
    const isAdmin = interaction.memberPermissions?.has(
      PermissionsBitField.Flags.Administrator
    );
    logger.debug(
      `[setcooldown] Permission check isOwner=${isOwner} isAdmin=${isAdmin}`
    );

    // Permission check: only owner or admin may proceed
    if (!isOwner && !isAdmin) {
      logger.debug(`[setcooldown] Permission denied for userId=${userId}`);
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
    logger.debug(
      `[setcooldown] Options retrieved time=${time} perUser=${perUser}`
    );

    // Ensure command is used in a guild
    const guildId = interaction.guild?.id;
    logger.debug(`[setcooldown] Interaction occurred in guildId=${guildId}`);
    if (!guildId) {
      logger.warn("[setcooldown] Command not in a guild context");
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Validate time argument
    if (time < 0) {
      logger.debug(`[setcooldown] Invalid time=${time}`);
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
    logger.debug(
      `[setcooldown] Saving newConfig for guildId=${guildId}: ${JSON.stringify(
        newConfig
      )}`
    );
    await saveGuildCooldownConfigs();

    logger.info(
      `[setcooldown] New cooldown for guild ${guildId}: ${JSON.stringify(
        newConfig
      )}`
    );

    // Confirm update to user
    await interaction.reply({
      content: `✅ Cooldown set to **${time}s** (${perUser ? "per user" : "global"})`,
      flags: MessageFlags.Ephemeral,
    });
    logger.debug(
      `[setcooldown] Reply sent to userId=${userId} in guildId=${guildId}`
    );
  } catch (err) {
    logger.error("[setcooldown] Unexpected error:", err);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ An error occurred while updating cooldown.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
