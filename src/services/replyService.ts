/**
 * @file src/services/replyService.ts
 * @description Builds the AI response prompt from conversation history, multimodal blocks (text, images, files),
 * invokes OpenAI for completion, renders LaTeX math blocks to images, and returns the cleaned reply text
 * along with any math image buffers.
 */

import { Block, ChatMessage } from "@/types";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { cloneMemory } from "../store/cloneMemory.js";
import { userMemory } from "../store/userMemory.js";
import { applyDiscordMarkdownFormatting } from "../utils/discordHelpers.js";
import { renderMathToPng } from "../utils/latexRenderer.js";
import logger from "../utils/logger.js";
import {
  cloneUserId,
  getCharacterDescription,
  markdownGuide,
} from "./characterService.js";

/**
 * A user message carrying structured blocks for multimodal input.
 */
export interface ChatCompletionBlockMessage {
  role: "user";
  content: Block[];
}

/**
 * Generate an AI reply based on conversation history, multimodal blocks, and context.
 *
 * @param convoHistory - Map of message IDs to ChatMessage objects representing the thread.
 * @param currentId - Discord message ID of the latest user message to reply to.
 * @param openai - Initialized OpenAI client for chat completions.
 * @param userId - Discord user ID to fetch appropriate memory and persona.
 * @param replyToInfo - Optional summary of the message triggering this reply.
 * @param channelHistory - Optional string of recent channel messages for broader context.
 * @param blocks - Pre-extracted blocks (text, image_url, file) from the user message.
 * @param genericUrls - Remaining links to include as text blocks.
 * @returns An object containing the final reply text and an array of PNG buffers for rendered math.
 */
export async function generateReply(
  convoHistory: Map<string, ChatMessage>,
  currentId: string,
  openai: OpenAI,
  userId: string,
  replyToInfo?: string,
  channelHistory?: string,
  blocks: Block[] = [],
  genericUrls: string[] = []
): Promise<{ text: string; mathBuffers: Buffer[] }> {
  // Feature toggles
  const useFT = process.env.USE_FINE_TUNED_MODEL === "true";
  const usePersona = process.env.USE_PERSONA === "true";
  const modelName = useFT ? process.env.FINE_TUNED_MODEL_NAME! : "gpt-4o";

  // Build system messages
  const messages: ChatCompletionMessageParam[] = [];

  const persona = await getCharacterDescription(userId);
  messages.push({ role: "system", content: persona });

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

  if (replyToInfo) messages.push({ role: "system", content: replyToInfo });

  if (channelHistory)
    messages.push({
      role: "system",
      content: `Recent channel history:\n${channelHistory}`,
    });

  messages.push({ role: "system", content: markdownGuide });

  // Build user-side blocks (history + current)
  const userBlocks: Block[] = [];
  let cursor: string | undefined = currentId;
  while (cursor) {
    const turn = convoHistory.get(cursor);
    if (!turn) break;
    const cleaned = applyDiscordMarkdownFormatting(turn.content);
    if (turn.role === "user") {
      userBlocks.unshift({
        type: "text",
        text: `${turn.name} asked: ${cleaned}`,
      });
    } else {
      userBlocks.unshift({ type: "text", text: cleaned });
    }
    cursor = turn.replyToId;
  }

  // Append the extracted multimodal blocks
  for (const b of blocks) {
    userBlocks.push(b);
  }

  // Append any leftover generic URLs as text blocks
  for (const url of genericUrls) {
    userBlocks.push({ type: "text", text: `[link] ${url}` });
  }

  // Package into a single user-block message
  const blockMessage: ChatCompletionBlockMessage = {
    role: "user",
    content: userBlocks,
  };
  messages.push(blockMessage as unknown as ChatCompletionMessageParam);

  logger.info(`📝 Prompt → model=${modelName}, blocks=${userBlocks.length}`);
  logger.debug(`Prompt context: ${JSON.stringify(messages, null, 2)}`);

  // Invoke OpenAI
  let aiContent: string;
  try {
    const res = await openai.chat.completions.create({
      model: modelName,
      messages,
      top_p: 0.6,
      frequency_penalty: 0.5,
      max_tokens: 2000,
    });
    aiContent = res.choices[0]?.message.content?.trim() || "";
    if (!aiContent) throw new Error("Empty AI response");
  } catch (err: unknown) {
    if (useFT && err instanceof APIError && err.code === "model_not_found") {
      logger.error(`Fine-tuned model not found: ${modelName}`);
      process.exit(1);
    }
    logger.error("OpenAI error in generateReply:", err);
    if (err instanceof APIError && err.code === "insufficient_quota") {
      return { text: "⚠️ The assistant is out of quota.", mathBuffers: [] };
    }
    throw err;
  }

  // Render any LaTeX math blocks
  const mathBuffers: Buffer[] = [];
  for (const match of aiContent.matchAll(/\\\[(.+?)\\\]/g)) {
    try {
      const { buffer } = await renderMathToPng(match[1].trim());
      mathBuffers.push(buffer);
    } catch (e) {
      logger.warn("Math→PNG failed for:", match[1], e);
    }
  }

  // Strip out the LaTeX markers from the text
  let replyText = aiContent.replace(/\\\[(.+?)\\\]/g, "");
  replyText = replyText.replace(/(\r?\n){2,}/g, "\n").trim();

  return { text: replyText, mathBuffers };
}
