/**
 * @file src/commands/ask.ts
 * @description Slash command to privately ask the AI assistant a question.
 *   Handles URL and attachment extraction, persona and memory injection,
 *   maths rendering, and ephemeral reply.
 * @remarks
 *   Workflow:
 *     1. Defer reply ephemerally for async processing
 *     2. Extract any attachments or inline media from the question
 *     3. Build AI prompt and invoke OpenAI
 *     4. Edit deferred reply with response text and maths images
 *     5. Update user memory with assistant’s reply
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
import { extractInputs } from "../utils/urlExtractor/index.js";

// Initialise OpenAI client with API key from environment
const openai = new OpenAI({ apiKey: getRequired("OPENAI_API_KEY")! });

/**
 * Slash command definition for /ask.
 * @param question - The user’s query to send to the assistant.
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
 * Execute the /ask command.
 *
 * @param interaction - The ChatInputCommandInteraction context.
 * @returns Resolves once the assistant’s reply is sent or an error is handled.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;
  const question = interaction.options.getString("question", true).trim();

  logger.debug(
    `[ask] /ask invoked by userId=${userId}, question='${question}'`
  );

  // Defer reply so we can reply asynchronously, and mark it ephemeral
  logger.debug("[ask] Deferring reply ephemerally");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Build a fake message to extract attachments and URLs
  const fakeMessage = {
    content: question,
    attachments: new Collection<string, unknown>(),
  } as unknown as Message;

  logger.debug("[ask] Extracting inputs from fake message");
  const { blocks, genericUrls } = await extractInputs(fakeMessage);
  logger.debug(
    `[ask] extractInputs returned ${blocks.length} blocks and ${genericUrls.length} generic URL(s)`
  );

  // Prepend the raw question as the first block
  blocks.unshift({ type: "text", text: question } as Block);

  // Prepare conversation history map for generateReply
  const convoHistory = new Map<string, ChatMessage>();
  const messageId = Date.now().toString();

  try {
    logger.debug("[ask] Invoking generateReply");
    const { text, mathBuffers } = await generateReply(
      convoHistory,
      messageId,
      openai,
      userId,
      undefined,
      undefined,
      blocks,
      genericUrls
    );
    logger.debug(
      `[ask] generateReply returned text length=${text.length}, maths buffer count=${mathBuffers.length}`
    );

    // Convert maths buffers to file attachments
    const files = mathBuffers.map((buf, idx) => ({
      attachment: buf,
      name: `maths-${idx}.png`,
    }));

    logger.debug("[ask] Editing deferred reply with assistant response");
    await interaction.editReply({ content: text, files });

    logger.debug("[ask] Updating user memory with assistant's reply");
    await updateUserMemory(userId, { timestamp: Date.now(), content: text });

    logger.debug("[ask] /ask command completed successfully");
  } catch (err) {
    logger.error("[ask] Unexpected error in /ask command:", err);
    // Inform user of failure
    await interaction.editReply({ content: "⚠️ Something went wrong." });
  }
}
