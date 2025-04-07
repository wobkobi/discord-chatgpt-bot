import axios from "axios";
import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
import logger from "../utils/logger.js";
dotenv.config();

export const data = new SlashCommandBuilder()
  .setName("checkcredits")
  .setDescription("Check remaining OpenAI API credits (Owner only).");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // Restrict command usage to the bot owner.
  if (interaction.user.id !== process.env.OWNER_ID) {
    await interaction.reply({
      content: "This command is owner only.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const response = await axios.get(
      "https://api.openai.com/dashboard/billing/credit_grants",
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );
    const { total_granted, total_used, total_available } = response.data;
    await interaction.editReply(
      `**OpenAI API Credit Info**\nTotal Granted: ${total_granted}\nTotal Used: ${total_used}\nTotal Available: ${total_available}`
    );
  } catch (error: unknown) {
    logger.error("Error checking OpenAI credits:", error);
    await interaction.editReply("Failed to fetch OpenAI credit information.");
  }
}
