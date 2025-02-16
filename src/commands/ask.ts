import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import dotenv from "dotenv";
import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";
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

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // Defer the reply as ephemeral so only the user sees it.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const question = interaction.options.getString("question", true);

  // Create a new OpenAI client instance.
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Build a simple prompt using a system message and the user's question.
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
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: prompt,
      max_tokens: 1000,
      top_p: 0.6,
      frequency_penalty: 0.5,
    });
    const answer = response.choices[0]?.message.content;
    if (!answer) throw new Error("No answer returned from OpenAI.");
    // Edit the deferred reply (ephemeral flag already applies).
    await interaction.editReply({ content: answer });
  } catch (error: unknown) {
    console.error("Error processing /ask command:", error);
    await interaction.editReply({
      content: "There was an error processing your request.",
    });
  }
}
