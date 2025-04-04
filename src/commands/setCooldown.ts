import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import {
  defaultCooldownConfig,
  guildCooldownConfigs,
  saveGuildCooldownConfigs,
} from "../config.js";
import logger from "../utils/logger.js";

const ownerId = process.env.OWNER_ID || "defaultOwnerId";

/**
 * Slash command definition for setting cooldown configurations.
 */
export const data = new SlashCommandBuilder()
  .setName("setcooldown")
  .setDescription(
    "Configure the cooldown settings for this server. (Owner only)"
  )
  .addNumberOption((option) =>
    option
      .setName("time")
      .setDescription("Cooldown time in seconds (e.g., 2.5)")
      .setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName("peruser")
      .setDescription(
        "If true, cooldown applies per user; if false, cooldown is global to the server."
      )
      .setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName("reset")
      .setDescription("If true, reset cooldown settings to factory defaults")
      .setRequired(false)
  );

/**
 * Executes the setcooldown command.
 * Only the bot owner can execute this command in a server.
 *
 * @param interaction - The command interaction object.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "You do not have permission to configure cooldown settings.",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const reset = interaction.options.getBoolean("reset") ?? false;
  if (reset) {
    guildCooldownConfigs.set(interaction.guildId, {
      useCooldown: defaultCooldownConfig.useCooldown,
      cooldownTime: defaultCooldownConfig.cooldownTime,
      perUserCooldown: defaultCooldownConfig.perUserCooldown,
    });
    await saveGuildCooldownConfigs();
    await interaction.reply({
      content: "Cooldown settings have been reset to factory defaults.",
      ephemeral: true,
    });
    return;
  }

  const cooldownTimeInSeconds =
    interaction.options.getNumber("time") ?? defaultCooldownConfig.cooldownTime;
  const perUserCooldown =
    interaction.options.getBoolean("peruser") ??
    defaultCooldownConfig.perUserCooldown;

  guildCooldownConfigs.set(interaction.guildId, {
    useCooldown: defaultCooldownConfig.useCooldown,
    cooldownTime: cooldownTimeInSeconds,
    perUserCooldown,
  });
  await saveGuildCooldownConfigs();
  await interaction.reply({
    content: `Cooldown settings updated: cooldown time is now ${cooldownTimeInSeconds} seconds, and cooldown is ${perUserCooldown ? "per user" : "global to the server"}.`,
    ephemeral: true,
  });
  logger.info(`Updated cooldown settings for guild ${interaction.guildId}`);
}
