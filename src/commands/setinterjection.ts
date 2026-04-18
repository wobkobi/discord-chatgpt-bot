/**
 * @file src/commands/setinterjection.ts
 * @description Slash command to configure how often the bot randomly interjects when not mentioned.
 *   Restricted to the bot owner or server administrators. Stores a "1 in N" chance (minimum N=50).
 */

import {
  defaultCooldownConfig,
  defaultInterjectionRate,
  guildConfigs,
  saveGuildConfigs,
} from "@/config/index.js";
import { getRequired } from "@/utils/env.js";
import logger from "@/utils/logger.js";
import {
  ChatInputCommandInteraction,
  InteractionContextType,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";

let OWNER_ID = "";
try {
  OWNER_ID = getRequired("OWNER_ID");
} catch {
  logger.warn("[setinterjection] OWNER_ID not configured; permission checks will fail safe.");
}

/**
 * Slash command definition for /setinterjection.
 */
export const data = new SlashCommandBuilder()
  .setName("setinterjection")
  .setDescription("Set how often the bot randomly interjects (1 in N chance; min N=50)")
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption((opt) =>
    opt
      .setName("rate")
      .setDescription("Denominator N for a '1 in N' random interjection chance")
      .setMinValue(50)
      .setRequired(true),
  );

/**
 * Executes the /setinterjection command.
 * @param interaction - The ChatInputCommandInteraction context.
 * @returns A promise that resolves once the command has been processed and replied to.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  if (!OWNER_ID) {
    await interaction.reply({
      content: "⚠️ Bot owner is not configured. Cannot change interjection rate.",
      ephemeral: true,
    });
    return;
  }

  const isOwner = OWNER_ID === userId;
  const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
  if (!isOwner && !isAdmin) {
    await interaction.reply({
      content:
        "🚫 You must be a server admin or the bot owner to configure interjection frequency.",
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

  const rate = interaction.options.getInteger("rate", true);
  if (rate < 50) {
    await interaction.reply({
      content: "❌ Rate must be at least 50 (i.e. a 1 in 50 chance).",
      ephemeral: true,
    });
    return;
  }

  const existing = guildConfigs.get(guildId) ?? {
    cooldown: defaultCooldownConfig,
    interjectionRate: defaultInterjectionRate,
  };

  existing.interjectionRate = rate;
  guildConfigs.set(guildId, existing);
  await saveGuildConfigs();
  logger.info(`[setinterjection] Guild ${guildId} interjection rate set to 1 in ${rate}`);

  await interaction.reply({
    content: `✅ Random interjection frequency set to **1 in ${rate}**.`,
    ephemeral: true,
  });
}
