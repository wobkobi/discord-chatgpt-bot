// src/commands/checkcredits.ts

import axios from "axios";
import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import dotenv from "dotenv";
import logger from "../utils/logger.js";

dotenv.config();

export const data = new SlashCommandBuilder()
  .setName("checkcredits")
  .setDescription("Check remaining OpenAI API credits (Owner only)");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const ownerId = process.env.OWNER_ID;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!ownerId || !apiKey) {
    logger.error("[checkcredits] Missing OWNER_ID or OPENAI_API_KEY in .env");
    await interaction.reply({
      content: "⚠️ Bot isn’t configured correctly.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "🚫 You’re not allowed to use this command.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { data } = await axios.get<{
      total_granted: number;
      total_used: number;
      total_available: number;
    }>("https://api.openai.com/dashboard/billing/credit_grants", {
      headers: { Authorisation: `Bearer ${apiKey}` },
      timeout: 5000,
    });

    const embed = new EmbedBuilder()
      .setTitle("💳 OpenAI API Credits")
      .setColor("Blue")
      .addFields(
        {
          name: "Total Granted",
          value: `\`${data.total_granted.toLocaleString()}\``,
          inline: true,
        },
        {
          name: "Total Used",
          value: `\`${data.total_used.toLocaleString()}\``,
          inline: true,
        },
        {
          name: "Available",
          value: `\`${data.total_available.toLocaleString()}\``,
          inline: true,
        }
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err: unknown) {
    logger.error("[checkcredits] failed to fetch credits:", err);
    const message =
      axios.isAxiosError(err) && err.response
        ? `Failed (${err.response.status} ${err.response.statusText})`
        : "An unexpected error occurred.";
    await interaction.editReply({
      content: `❌ Could not fetch credit info: ${message}`,
    });
  }
}
