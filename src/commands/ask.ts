// src/commands/ask.ts
/**
 * @description Slash command to privately ask the AI assistant a question.
 */

import { generateReply } from "@/services/replyService";
import { updateUserMemory } from "@/store/userMemory";
import type { Block, ChatMessage } from "@/types/index";
import { getRequired } from "@/utils/env";
import logger from "@/utils/logger";
import {
  getCooldownConfig,
  getCooldownContext,
  isCooldownActive,
  manageCooldown,
} from "@/utils/rateControl";
import { extractInputs } from "@/utils/urlExtractor/index";
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

  // Same cooldown rules as the message path; slash commands are otherwise uncapped
  const guildId = interaction.guildId ?? null;
  const { useCooldown, cooldownTime } = getCooldownConfig(guildId);
  if (useCooldown && isCooldownActive(getCooldownContext(guildId, userId))) {
    await interaction.reply({
      content: `⏳ Cooldown: ${cooldownTime.toFixed(2)}s`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (useCooldown) manageCooldown(guildId, userId);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Minimal Message stand-in for extractInputs; every collection it reads must exist
  const fakeMessage = {
    content: question,
    attachments: new Collection<string, unknown>(),
    stickers: new Collection<string, unknown>(),
  } as unknown as Message;

  const convoHistory = new Map<string, ChatMessage>();
  const messageId = Date.now().toString();

  try {
    const { blocks, genericUrls } = await extractInputs(fakeMessage);
    blocks.unshift({ type: "text", text: question } as Block);

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
    // Both halves of the exchange - the question is the part worth remembering
    const now = Date.now();
    await updateUserMemory(userId, {
      timestamp: now,
      content: `${interaction.user.username} said: ${question}`,
    });
    await updateUserMemory(userId, { timestamp: now, content: `Replied: ${text}` });
  } catch (err) {
    logger.error("[ask] Unexpected error in /ask command:", err);
    await interaction.editReply({ content: "⚠️ Something went wrong." });
  }
}
