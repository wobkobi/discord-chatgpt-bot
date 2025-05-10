/**
 * @file src/commands/setinterjection.ts
 * @description Slash command to configure how often the bot randomly interjects when not mentioned.
 *   Restricted to the bot owner or server administrators.
 *
 *   Stores a “1 in N” chance per server (minimum N=50). Persists configuration to disk.
 */
import {
  ChatInputCommandInteraction,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import {
  defaultCooldownConfig,
  defaultInterjectionRate,
  guildConfigs,
  saveGuildConfigs,
} from "../config/index.js";
import { getRequired } from "../utils/env.js";
import logger from "../utils/logger.js";

const OWNER_ID = getRequired("OWNER_ID");

/**
 * Slash command definition for /setinterjection.
 * @param rate - Denominator N for a “1 in N” random interjection chance (must be ≥50).
 */
export const data = new SlashCommandBuilder()
  .setName("setinterjection")
  .setDescription(
    "Set how often the bot randomly interjects (1 in N chance; min N=50)"
  )
  .addIntegerOption((opt) =>
    opt
      .setName("rate")
      .setDescription("Denominator N for a ‘1 in N’ random interjection chance")
      .setMinValue(50)
      .setRequired(true)
  );

/**
 * Executes the /setinterjection command.
 * @param interaction - The ChatInputCommandInteraction context.
 * @returns A promise that resolves once the command has been processed and replied to.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;
  logger.debug(`[setinterjection] Invoked by userId=${userId}`);

  // Permission check
  const isOwner = OWNER_ID === userId;
  const isAdmin = interaction.memberPermissions?.has(
    PermissionsBitField.Flags.Administrator
  );
  if (!isOwner && !isAdmin) {
    logger.debug(`[setinterjection] Permission denied for userId=${userId}`);
    await interaction.reply({
      content:
        "🚫 You must be a server admin or the bot owner to configure interjection frequency.",
      ephemeral: true,
    });
    return;
  }

  // Ensure in a guild
  const guildId = interaction.guild?.id;
  if (!guildId) {
    logger.warn("[setinterjection] Command not in a guild context");
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Retrieve & validate option
  const rate = interaction.options.getInteger("rate", true);
  if (rate < 50) {
    logger.debug(`[setinterjection] Invalid rate=${rate}`);
    await interaction.reply({
      content: "❌ Rate must be at least 50 (i.e. a 1 in 50 chance).",
      ephemeral: true,
    });
    return;
  }

  // Get existing or defaults
  const existing = guildConfigs.get(guildId) ?? {
    cooldown: defaultCooldownConfig,
    interjectionRate: defaultInterjectionRate,
  };

  // Update and persist
  existing.interjectionRate = rate;
  guildConfigs.set(guildId, existing);
  await saveGuildConfigs();
  logger.info(
    `[setinterjection] Guild ${guildId} interjection rate set to 1 in ${rate}`
  );

  // Confirm to user
  await interaction.reply({
    content: `✅ Random interjection frequency set to **1 in ${rate}**.`,
    ephemeral: true,
  });
  logger.debug(
    `[setinterjection] Confirmation sent to userId=${userId} in guildId=${guildId}`
  );
}
