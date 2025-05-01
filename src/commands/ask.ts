/**
 * @file src/commands/ask.ts
 * @description Slash command for querying the AI assistant via OpenAI, including persona and memory management.
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
 * @throws When OPENAI_KEY is not defined.
 */
const OPENAI_KEY = process.env.OPENAI_API_KEY!;
if (!OPENAI_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

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
 * Handles the /ask interaction by deferring the reply, validating user permissions,
 * building the prompt (including persona and memory), querying OpenAI, and editing the reply.
 *
 * @param interaction - The ChatInputCommandInteraction context for the slash command.
 * @throws When OpenAI returns no content or editing the reply fails.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;
  const question = interaction.options.getString("question", true).trim();

  logger.info(`[ask] ${userId} → "${question}"`);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Permission: only bot owner or clone user can invoke
  if (userId !== process.env.OWNER_ID && userId !== cloneUserId) {
    await interaction.editReply({
      content: "🚫 You cannot ask me questions directly.",
    });
    return;
  }

  // Determine which model to use
  const useFT = process.env.USE_FINE_TUNED_MODEL === "true";
  const modelName = useFT ? process.env.FINE_TUNED_MODEL_NAME! : "gpt-4o";

  // Build chat messages with persona and memory
  const messages: ChatCompletionMessageParam[] = [];
  if (process.env.USE_PERSONA === "true") {
    const persona = await getCharacterDescription(userId);
    messages.push({ role: "system", content: persona });

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

  // Add the user's question
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
