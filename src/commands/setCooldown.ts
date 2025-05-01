// src/commands/setcooldown.ts

import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import {
  defaultCooldownConfig,
  GuildCooldownConfig,
  guildCooldownConfigs,
  saveGuildCooldownConfigs,
} from "../config/index.js";
import logger from "../utils/logger";

const OWNER_ID = process.env.OWNER_ID;

/**
 * /setcooldown
 */
export const data = new SlashCommandBuilder()
  .setName("setcooldown")
  .setDescription("Configure this server’s message cooldown (owner only).")
  .addNumberOption((opt) =>
    opt
      .setName("time")
      .setDescription("Cooldown in seconds (≥0).")
      .setMinValue(0)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("peruser")
      .setDescription("If true, each user has their own cooldown.")
  )
  .addBooleanOption((opt) =>
    opt
      .setName("reset")
      .setDescription("Reset to the default cooldown settings.")
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  try {
    // permissions
    if (!OWNER_ID || interaction.user.id !== OWNER_ID) {
      await interaction.reply({
        content: "🚫 Only the bot owner can change cooldown settings.",
        ephemeral: true,
      });
      return;
    }
    if (!interaction.guildId) {
      await interaction.reply({
        content: "⚠️ This command must be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guildId;
    const reset = interaction.options.getBoolean("reset") ?? false;

    if (reset) {
      guildCooldownConfigs.set(guildId, { ...defaultCooldownConfig });
      await saveGuildCooldownConfigs();
      logger.info(`Cooldown reset to defaults for guild ${guildId}`);
      await interaction.reply({
        content: "✅ Cooldown settings reset to defaults.",
        ephemeral: true,
      });
      return;
    }

    // read inputs or fall back
    const time =
      interaction.options.getNumber("time") ??
      defaultCooldownConfig.cooldownTime;
    const perUser =
      interaction.options.getBoolean("peruser") ??
      defaultCooldownConfig.perUserCooldown;

    // validate
    if (time < 0) {
      await interaction.reply({
        content: "⏱️ Cooldown time must be zero or positive.",
        ephemeral: true,
      });
      return;
    }

    const newConfig: GuildCooldownConfig = {
      useCooldown: true,
      cooldownTime: time,
      perUserCooldown: perUser,
    };
    guildCooldownConfigs.set(guildId, newConfig);
    await saveGuildCooldownConfigs();

    logger.info(
      `Cooldown updated for guild ${guildId}: time=${time}s, perUser=${perUser}`
    );
    await interaction.reply({
      content: `✅ Cooldown updated: **${time}s**, scope: **${perUser ? "per user" : "global"}**`,
      ephemeral: true,
    });
  } catch (err) {
    logger.error("[setcooldown] unexpected error:", err);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ An error occurred while updating cooldown.",
        ephemeral: true,
      });
    }
  }
}
