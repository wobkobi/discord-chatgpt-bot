import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import logger from "../utils/logger.js";

dotenv.config();

export const data = new SlashCommandBuilder()
  .setName("ask")
  .setDescription("Ask the bot a question privately")
  .addStringOption((option) =>
    option
      .setName("question")
      .setDescription("The question you want to ask")
      .setRequired(true)
  );

/**
 * Executes the /ask command by sending the user's question to OpenAI and
 * editing the reply with the generated answer.
 *
 * @param interaction - The command interaction object.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // Defer the reply so that only the user sees it.
  await interaction.deferReply({ ephemeral: true });

  // Retrieve the question provided by the user.
  const question = interaction.options.getString("question", true);

  // Create a new OpenAI client instance.
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Build the prompt for OpenAI.
  const prompt: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: "You are a helpful and concise assistant.",
      name: undefined,
    },
    {
      role: "user",
      content: question,
      name: undefined,
    },
  ];

  try {
    // Request a completion from OpenAI.
    const response = await openai.chat.completions.create({
      model: "gpt-4.5-preview",
      messages: prompt,
      max_tokens: 1000,
      top_p: 0.6,
      frequency_penalty: 0.5,
    });
    const answer = response.choices[0]?.message.content;
    if (!answer) {
      throw new Error("No answer returned from OpenAI.");
    }
    // Edit the deferred reply with the generated answer.
    await interaction.editReply({ content: answer });
  } catch (error: unknown) {
    logger.error("Error processing /ask command:", error);
    await interaction.editReply({
      content: "There was an error processing your request.",
    });
  }
}
