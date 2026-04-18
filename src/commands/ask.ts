/**
 * @file src/commands/ask.ts
 * @description Slash command to privately ask the AI assistant a question.
 */

import { generateReply } from "@/services/replyService.js";
import { updateUserMemory } from "@/store/userMemory.js";
import type { Block, ChatMessage } from "@/types/index.js";
import { getRequired } from "@/utils/env.js";
import logger from "@/utils/logger.js";
import { extractInputs } from "@/utils/urlExtractor/index.js";
import {
  ChatInputCommandInteraction,
  Collection,
  Message,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: getRequired("OPENAI_API_KEY") });

/**
 * Slash command definition for /ask.
 */
export const data = new SlashCommandBuilder()
  .setName("ask")
  .setDescription("Ask the bot a question privately")
  .addStringOption((opt) =>
    opt.setName("question").setDescription("Your question for the assistant").setRequired(true),
  );

/**
 * Execute the /ask command: extracts inputs, generates an AI reply, and sends it ephemerally.
 * @param interaction - The ChatInputCommandInteraction context.
 * @returns Resolves once the assistant's reply is sent or an error is handled.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const question = interaction.options.getString("question", true).trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const fakeMessage = {
    content: question,
    attachments: new Collection<string, unknown>(),
  } as unknown as Message;

  const { blocks, genericUrls } = await extractInputs(fakeMessage);
  blocks.unshift({ type: "text", text: question } as Block);

  const convoHistory = new Map<string, ChatMessage>();
  const messageId = Date.now().toString();

  try {
    const { text, mathBuffers } = await generateReply(
      convoHistory,
      messageId,
      openai,
      userId,
      undefined,
      blocks,
      genericUrls,
    );
    const files = mathBuffers.map((buf, idx) => ({ attachment: buf, name: `maths-${idx}.png` }));
    await interaction.editReply({ content: text, files });
    await updateUserMemory(userId, { timestamp: Date.now(), content: text });
  } catch (err) {
    logger.error("[ask] Unexpected error in /ask command:", err);
    await interaction.editReply({ content: "⚠️ Something went wrong." });
  }
}
