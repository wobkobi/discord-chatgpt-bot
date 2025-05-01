// src/commands/ask.ts

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

const OPENAI_KEY = process.env.OPENAI_API_KEY!;
if (!OPENAI_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const openai = new OpenAI({ apiKey: OPENAI_KEY });

export const data = new SlashCommandBuilder()
  .setName("ask")
  .setDescription("Ask the bot a question privately")
  .addStringOption((opt) =>
    opt
      .setName("question")
      .setDescription("Your question for the assistant")
      .setRequired(true)
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;
  const question = interaction.options.getString("question", true).trim();
  logger.info(`[ask] ${userId} → "${question}"`);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Choose model
  const useFT = process.env.USE_FINE_TUNED_MODEL === "true";
  const modelName = useFT ? process.env.FINE_TUNED_MODEL_NAME! : "gpt-4o";

  // Build the prompt messages
  const messages: ChatCompletionMessageParam[] = [];

  // 1) persona + memory
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

  // 2) the user’s question
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
