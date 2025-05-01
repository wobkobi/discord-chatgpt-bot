/**
 * @file src/commands/ask.ts
 * @description Slash command for querying the AI assistant via OpenAI, with optional persona and memory integration.
 */

import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import dotenv from "dotenv";
import OpenAI, { APIError } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

import {
  cloneUserId,
  getCharacterDescription,
} from "../services/characterService.js";
import { cloneMemory } from "../store/cloneMemory.js";
import { userMemory } from "../store/userMemory.js";
import logger from "../utils/logger.js";

dotenv.config();

/**
 * Required OpenAI API key loaded from environment.
 * @throws When OPENAI_API_KEY is not defined.
 */
const OPENAI_KEY = process.env.OPENAI_API_KEY!;
if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY is required");

/**
 * OpenAI client for generating chat completions.
 */
const openai = new OpenAI({ apiKey: OPENAI_KEY });

/**
 * Slash command registration data for /ask.
 */
export const data = new SlashCommandBuilder()
  .setName("ask")
  .setDescription("Ask the bot a question privately")
  .addStringOption((opt) =>
    opt
      .setName("question")
      .setDescription("Your question for the assistant")
      .setRequired(true)
  );

/**
 * Executes the /ask command.
 * Builds and sends a prompt including optional persona and memory for fine-tuned or persona modes.
 *
 * @param interaction - The ChatInputCommandInteraction context.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;
  const question = interaction.options.getString("question", true).trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Determine model & feature toggles
  const useFT = process.env.USE_FINE_TUNED_MODEL === "true";
  const usePersona = process.env.USE_PERSONA === "true";
  const modelName = useFT ? process.env.FINE_TUNED_MODEL_NAME! : "gpt-4o";

  const messages: ChatCompletionMessageParam[] = [];

  // 1) Persona prompt if enabled
  if (usePersona) {
    const persona = await getCharacterDescription(userId);
    messages.push({ role: "system", content: persona });
  }

  // 2) Memory injection if persona OR fine-tuned
  if (usePersona || useFT) {
    const memArr =
      userId === cloneUserId
        ? cloneMemory.get(userId) || []
        : userMemory.get(userId) || [];
    if (memArr.length) {
      const prefix =
        userId === cloneUserId ? "Clone memory:\n" : "Long-term memory:\n";
      messages.push({
        role: "system",
        content: prefix + memArr.map((e) => e.content).join("\n"),
      });
    }
  }

  // 3) User question
  messages.push({ role: "user", content: question });
  logger.info(
    `[ask] Prompt → model=${modelName}, messages=\n${JSON.stringify(
      messages,
      null,
      2
    )}`
  );

  try {
    const start = Date.now();
    const response = await openai.chat.completions.create({
      model: modelName,
      messages,
      max_tokens: 1000,
      top_p: 0.6,
      frequency_penalty: 0.5,
      temperature: 0.7,
    });

    const answer = response.choices[0]?.message.content?.trim();
    if (!answer) throw new Error("Empty response from OpenAI");

    logger.info(`[ask] Responded in ${Date.now() - start}ms`);
    await interaction.editReply({ content: answer });
  } catch (err: unknown) {
    logger.error("[ask] OpenAI error:", err);
    const msg =
      err instanceof APIError && err.code === "insufficient_quota"
        ? "⚠️ The assistant is out of quota right now."
        : "❌ Oops, something went wrong. Please try again later.";
    await interaction.editReply({ content: msg });
  }
}
