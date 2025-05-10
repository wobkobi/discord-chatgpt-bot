/**
 * @file src/commands/setcooldown.ts
 * @description Slash command to configure this server’s message cooldown settings.
 *   Restricted to the bot owner or server administrators.
 * @remarks
 *   Validates permissions, updates the guild’s combined config object,
 *   and persists via saveGuildConfigs().
 */
import {
  ChatInputCommandInteraction,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import {
  defaultCooldownConfig,
  defaultInterjectionRate,
  GuildConfig,
  guildConfigs,
  saveGuildConfigs,
} from "../config/index.js";
import { getRequired } from "../utils/env.js";
import logger from "../utils/logger.js";

const OWNER_ID = getRequired("OWNER_ID");

/**
 * Helper to turn seconds into a human-friendly string.
 * e.g. 60 → "1 minute", 120 → "2 minutes", 75 → "75 seconds"
 */
function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hrs = seconds / 3600;
    return `${hrs} hour${hrs !== 1 ? "s" : ""}`;
  }
  if (seconds % 60 === 0) {
    const mins = seconds / 60;
    return `${mins} minute${mins !== 1 ? "s" : ""}`;
  }
  return `${seconds} second${seconds !== 1 ? "s" : ""}`;
}

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

  // Permission check
  const isOwner = OWNER_ID === userId;
  const isAdmin = interaction.memberPermissions?.has(
    PermissionsBitField.Flags.Administrator
  );
  if (!isOwner && !isAdmin) {
    await interaction.reply({
      content:
        "🚫 You must be a server administrator or the bot owner to configure cooldown.",
      ephemeral: true,
    });
    return;
  }

  // Must be in a guild
  const guildId = interaction.guild?.id;
  if (!guildId) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Read options
  const time = interaction.options.getNumber("time", true);
  const perUser = interaction.options.getBoolean("peruser") ?? false;

  if (time < 0) {
    await interaction.reply({
      content: "⏱️ Cooldown time must be zero or positive.",
      ephemeral: true,
    });
    return;
  }

  // Fetch existing config or defaults
  const existing: GuildConfig = guildConfigs.get(guildId) ?? {
    cooldown: defaultCooldownConfig,
    interjectionRate: defaultInterjectionRate,
  };

  // Build updated config
  const newConfig: GuildConfig = {
    cooldown: {
      useCooldown: time > 0,
      cooldownTime: time,
      perUserCooldown: perUser,
    },
    interjectionRate: existing.interjectionRate,
  };

  // Persist
  guildConfigs.set(guildId, newConfig);
  await saveGuildConfigs();
  logger.info(
    `[setcooldown] Guild ${guildId} cooldown updated: ${JSON.stringify(
      newConfig.cooldown
    )}`
  );

  // Confirmation message
  const durationText = time === 0 ? "" : formatDuration(time);
  const scopeText = time === 0 ? "" : perUser ? "per user" : "globally";
  const reply =
    time === 0
      ? `✅ Cooldown disabled.`
      : `✅ Cooldown set to **${durationText}** ${scopeText}.`;

  await interaction.reply({
    content: reply,
    ephemeral: true,
  });
}
