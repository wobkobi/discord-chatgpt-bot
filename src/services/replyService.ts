/**
 * @file src/services/replyService.ts
 * @description Constructs the AI response prompt from conversation history and multimodal blocks,
 *   invokes OpenAI for chat completion, renders LaTeX maths to PNG buffers, and returns cleaned
 *   reply text along with any generated maths images.
 * @remarks
 *   Utilises persona and memory stores, applies Discord markdown formatting, and handles
 *   model errors (quota and model-not-found) with appropriate logging and fallback messages.
 *   Includes debug logs via `logger.debug` for tracing each step.
 */

import { Block, ChatMessage } from "@/types";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { cloneMemory } from "../store/cloneMemory.js";
import { userMemory } from "../store/userMemory.js";
import { applyDiscordMarkdownFormatting } from "../utils/discordHelpers.js";
import { getRequired } from "../utils/env.js";
import { renderMathToPng } from "../utils/latexRenderer.js";
import logger from "../utils/logger.js";
import {
  cloneUserId,
  getCharacterDescription,
  markdownGuide,
} from "./characterService.js";

/**
 * Structured user message containing an array of multimodal blocks.
 */
export interface ChatCompletionBlockMessage {
  /** Role for block messages; always 'user'. */
  role: "user";
  /** Sequence of content blocks (text, images, files). */
  content: Block[];
}

/**
 * Generate an AI reply based on provided context and input blocks.
 *
 * @param convoHistory - Map of message IDs to ChatMessage objects representing the thread history.
 * @param currentId - Discord message ID of the latest user message.
 * @param openai - An initialized OpenAI client instance.
 * @param userId - Discord user ID for memory and persona selection.
 * @param replyToInfo - Optional system note summarising what triggered this reply.
 * @param channelHistory - Optional literal string of recent channel messages for additional context.
 * @param blocks - Pre-extracted multimodal Blocks from the user message.
 * @param genericUrls - Remaining URLs to include as text blocks.
 * @returns Promise resolving to an object with the cleaned reply text and array of PNG buffers for rendered maths.
 * @throws Rethrows unexpected OpenAI errors after handling quota and model-not-found cases.
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
  logger.debug(
    `[replyService] generateReply invoked for userId=${userId}, currentId=${currentId}`
  );

  // Feature toggles
  const useFT = getRequired("USE_FINE_TUNED_MODEL") === "true";
  const usePersona = getRequired("USE_PERSONA") === "true";
  const modelName = useFT ? getRequired("FINE_TUNED_MODEL_NAME")! : "gpt-4o";
  logger.debug(
    `[replyService] Configuration useFT=${useFT}, usePersona=${usePersona}, modelName=${modelName}`
  );

  // Assemble messages for OpenAI
  const messages: ChatCompletionMessageParam[] = [];

  // System persona prompt
  const personaPrompt = await getCharacterDescription(userId);
  messages.push({ role: "system", content: personaPrompt });
  logger.debug("[replyService] Added system persona prompt");

  // Long-term or clone memory
const rawMemArr = userId === cloneUserId
  ? cloneMemory.get(userId) || []
  : userMemory.get(userId) || [];
const memArr = rawMemArr.map((e) => ({
  ...e,
  content: sanitiseInput(e.content),
}));
if (memArr.length) {
  // Build a concise memory block, limiting to the most recent entries
  let prefix = userId === cloneUserId ? "Clone memory:" : "Long-term memory:";
  const maxMemEntries = 15;
  let entriesToShow = memArr;
  if (memArr.length > maxMemEntries) {
    const omitted = memArr.length - maxMemEntries;
    entriesToShow = memArr.slice(-maxMemEntries);
    prefix += ` (Showing ${maxMemEntries} of ${memArr.length} entries; ${omitted} older entries omitted)`;
  }
  const memContent =
    prefix + "\n" + entriesToShow.map((e) => e.content).join("\n");

  messages.push({ role: "system", content: memContent });
  logger.debug(
    `[replyService] Added memory block, count=${entriesToShow.length}/${memArr.length}`
  );
}

  // Optional system injections
  if (replyToInfo) {
    messages.push({ role: "system", content: replyToInfo });
    logger.debug("[replyService] Added replyToInfo");
  }
  if (channelHistory) {
    messages.push({
      role: "system",
      content: `Recent channel history:\n${channelHistory}`,
    });
    logger.debug("[replyService] Added channelHistory");
  }
  messages.push({ role: "system", content: markdownGuide });
  logger.debug("[replyService] Added markdown guide");

  // Reconstruct user conversation history blocks
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
  logger.debug(
    `[replyService] Reconstructed user history blocks, count=${userBlocks.length}`
  );

  // Append new blocks and URLs
  userBlocks.push(...blocks);
  for (const url of genericUrls) {
    userBlocks.push({ type: "text", text: `[link] ${url}` });
  }
  logger.debug(
    `[replyService] Appended user multimodal blocks, total=${userBlocks.length}`
  );

  // Wrap in block message
  const blockMessage: ChatCompletionBlockMessage = {
    role: "user",
    content: userBlocks,
  };
  messages.push(blockMessage as unknown as ChatCompletionMessageParam);

  // Invoke OpenAI
  let content: string;
  let res: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>>;
  try {
    logger.debug("[replyService] Sending chat completion request");
    res = await openai.chat.completions.create({
      model: modelName,
      messages,
      temperature: 0.7,
      top_p: 0.8,
      frequency_penalty: 0.3,
      presence_penalty: 0.1,
      max_tokens: 512,
      user: userId,
    });
    content = res.choices[0]?.message.content?.trim() || "";
    if (!content) throw new Error("Empty AI response");
    logger.debug("[replyService] Received AI response");
  } catch (err) {
    if (useFT && err instanceof APIError && err.code === "model_not_found") {
      logger.error(`Fine-tuned model not found: ${modelName}`);
      process.exit(1);
    }
    logger.error("[replyService] OpenAI error:", err);
    if (err instanceof APIError && err.code === "insufficient_quota") {
      return { text: "⚠️ The assistant is out of quota.", mathBuffers: [] };
    }
    throw err;
  }

  // Log token usage for prompt vs completion
  const { usage } = res;
  logger.info(
    `📝 Prompt → model=${modelName} | prompt tokens: ${usage?.prompt_tokens ?? "?"}, completion tokens: ${usage?.completion_tokens ?? "?"}`
  );
  logger.debug(`Prompt context: ${JSON.stringify(messages, null, 2)}`);

  // Render maths to PNG
  const mathBuffers: Buffer[] = [];
  for (const match of content.matchAll(/\\\[(.+?)\\\]/g)) {
    try {
      const { buffer } = await renderMathToPng(match[1].trim());
      mathBuffers.push(buffer);
    } catch (err) {
      logger.warn("[replyService] Maths→PNG failed for:", match[1], err);
    }
  }

  // Clean reply text
  let replyText = content.replace(/\\\[(.+?)\\\]/g, "");
  replyText = replyText.replace(/(\r?\n){2,}/g, "\n").trim();
  logger.debug(`[replyService] Final reply text length=${replyText.length}`);

  return { text: replyText, mathBuffers };
}
