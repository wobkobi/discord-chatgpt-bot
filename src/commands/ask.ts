/**
 * @file src/commands/ask.ts
 * @description Slash command to privately ask the AI assistant a question, handling
 *   URL and attachment extraction, persona and memory injection, math rendering, and
 *   ephemeral reply.
 */
import type { Block, ChatMessage } from "@/types/index.js";
import {
  ChatInputCommandInteraction,
  Collection,
  Message,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import OpenAI from "openai";
import { generateReply } from "../services/replyService.js";
import { updateUserMemory } from "../store/userMemory.js";
import { getRequired } from "../utils/env.js";
import logger from "../utils/logger.js";
import { extractInputs } from "../utils/urlExtractor.js";

// Initialize OpenAI client with API key from environment
const openai = new OpenAI({ apiKey: getRequired("OPENAI_API_KEY")! });

/**
 * Slash command definition for /ask.
 * @property {string} question The user’s query to send to the assistant.
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
 * Executes the /ask command: extracts inputs, builds the AI prompt, sends to OpenAI,
 * and returns an ephemeral reply with optional math images.
 * @param {ChatInputCommandInteraction} interaction The Discord interaction context.
 * @returns {Promise<void>}
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;
  const question = interaction.options.getString("question", true).trim();

  // Defer reply so we can send asynchronously, mark as ephemeral
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Create a fake Message for URL/file extraction
  const attachments = new Collection<string, unknown>();
  const fakeMessage = { content: question, attachments } as unknown as Message;
  const { blocks, genericUrls } = await extractInputs(fakeMessage);

  // Include the raw question as the first text block
  blocks.unshift({ type: "text", text: question } as Block);

  // Prepare conversation history map for replyService
  const convoHistory = new Map<string, ChatMessage>();
  const currentId = Date.now().toString();

  try {
    // Generate assistant reply and any math image buffers
    const { text, mathBuffers } = await generateReply(
      convoHistory,
      currentId,
      openai,
      userId,
      undefined,
      undefined,
      blocks,
      genericUrls
    );

    // Convert math buffers into file attachments
    const files = mathBuffers.map((buf, i) => ({
      attachment: buf,
      name: `math-${i}.png`,
    }));

    // Edit deferred reply with content and attachments
    await interaction.editReply({ content: text, files });

    // Store AI response in user memory
    await updateUserMemory(userId, { timestamp: Date.now(), content: text });
  } catch (err) {
    logger.error("Error in /ask command:", err);
    // If something fails, notify the user
    await interaction.editReply({ content: "⚠️ Something went wrong." });
  }
}
