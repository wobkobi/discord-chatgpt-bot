/**
 * @file src/commands/setCooldown.ts
 * @description Slash command to configure this server's message cooldown settings.
 *   Restricted to the bot owner or server administrators.
 */

import {
  defaultCooldownConfig,
  defaultInterjectionRate,
  guildConfigs,
  saveGuildConfigs,
} from "@/config/index.js";
import { GuildConfig } from "@/types/guild.js";
import { getRequired } from "@/utils/env.js";
import logger from "@/utils/logger.js";
import { ChatInputCommandInteraction, PermissionsBitField, SlashCommandBuilder } from "discord.js";

let OWNER_ID = "";
try {
  OWNER_ID = getRequired("OWNER_ID");
} catch (err) {
  logger.warn(
    "[setcooldown] OWNER_ID not configured; permission checks will treat no one as owner.",
    err,
  );
}

/**
 * Format a duration in seconds as a human-friendly string.
 * @param seconds - The duration in seconds to format.
 * @returns A string such as `"1 minute"`, `"2 hours"`, or `"75 seconds"`.
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
 */
export const data = new SlashCommandBuilder()
  .setName("setcooldown")
  .setDescription("Configure this server's message cooldown (owner/admin only)")
  .addNumberOption((opt) =>
    opt
      .setName("time")
      .setDescription("Cooldown duration in seconds (0 to disable)")
      .setRequired(true),
  )
  .addBooleanOption((opt) =>
    opt
      .setName("peruser")
      .setDescription("Apply cooldown per user instead of globally")
      .setRequired(false),
  );

/**
 * Executes the /setcooldown command.
 * @param interaction - The ChatInputCommandInteraction context.
 * @returns Promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  if (!OWNER_ID) {
    await interaction.reply({
      content: "⚠️ Bot owner is not configured. Cooldown cannot be changed right now.",
      ephemeral: true,
    });
    return;
  }

  const isOwner = OWNER_ID === userId;
  const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
  if (!isOwner && !isAdmin) {
    await interaction.reply({
      content: "🚫 You must be a server administrator or the bot owner to configure cooldown.",
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guild?.id;
  if (!guildId) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const time = interaction.options.getNumber("time", true);
  const perUser = interaction.options.getBoolean("peruser") ?? false;

  if (time < 0) {
    await interaction.reply({
      content: "⏱️ Cooldown time must be zero or positive.",
      ephemeral: true,
    });
    return;
  }

  const existing: GuildConfig = guildConfigs.get(guildId) ?? {
    cooldown: defaultCooldownConfig,
    interjectionRate: defaultInterjectionRate,
  };

  const newConfig: GuildConfig = {
    cooldown: { useCooldown: time > 0, cooldownTime: time, perUserCooldown: perUser },
    interjectionRate: existing.interjectionRate,
  };

  guildConfigs.set(guildId, newConfig);
  await saveGuildConfigs();
  logger.info(
    `[setcooldown] Guild ${guildId} cooldown updated: ${JSON.stringify(newConfig.cooldown)}`,
  );

  const durationText = time === 0 ? "" : formatDuration(time);
  const scopeText = time === 0 ? "" : perUser ? "per user" : "globally";
  const reply =
    time === 0 ? `✅ Cooldown disabled.` : `✅ Cooldown set to **${durationText}** ${scopeText}.`;

  await interaction.reply({ content: reply, ephemeral: true });
}
