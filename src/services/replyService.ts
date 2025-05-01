/**
 * @file src/services/replyService.ts
 * @description Builds the AI response prompt from conversation history, channel context, and memory,
 *              invokes OpenAI for completion, renders LaTeX math blocks to images, and returns
 *              the cleaned reply text along with any math image buffers.
 */

import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";

import { ChatMessage } from "@/types";
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
 * Generate an AI reply based on conversation history and context.
 *
 * @param convoHistory - Map of message IDs to ChatMessage objects representing the thread.
 * @param currentId - Discord message ID of the latest user message to reply to.
 * @param openai - Initialized OpenAI client for chat completions.
 * @param userId - Discord user ID to fetch appropriate memory and persona.
 * @param replyToInfo - Optional summary of the message triggering this reply (for system context).
 * @param channelHistory - Optional string of recent channel messages for broader context.
 * @param imageUrls - List of image URLs (attachments, Tenor, Giphy) for context.
 * @param genericUrls - List of other URLs mentioned in the message.
 * @returns An object containing the final reply text and an array of PNG buffers for rendered math.
 * @throws If OpenAI returns an empty response or a non-recoverable error occurs.
 */
export async function generateReply(
  convoHistory: Map<string, ChatMessage>,
  currentId: string,
  openai: OpenAI,
  userId: string,
  replyToInfo?: string,
  channelHistory?: string,
  imageUrls: string[] = [],
  genericUrls: string[] = []
): Promise<{ text: string; mathBuffers: Buffer[] }> {
  // Select model (fine-tuned or default)
  const useFT = process.env.USE_FINE_TUNED_MODEL === "true";
  const modelName = useFT
    ? process.env.FINE_TUNED_MODEL_NAME! ||
      (logger.error("FINE_TUNED_MODEL_NAME missing, exiting."),
      process.exit(1),
      "")
    : "gpt-4o";

  // Build system and user messages for the chat completion
  const messages: ChatCompletionMessageParam[] = [];
  if (process.env.USE_PERSONA === "true") {
    // Persona and long-term or clone memory
    const persona = await getCharacterDescription(userId);
    messages.push({ role: "system", content: persona });
    const memArr =
      userId === cloneUserId
        ? cloneMemory.get(userId) || []
        : userMemory.get(userId) || [];
    if (memArr.length > 0) {
      const prefix =
        userId === cloneUserId ? "Clone memory:\n" : "Long-term memory:\n";
      messages.push({
        role: "system",
        content: prefix + memArr.map((e) => e.content).join("\n"),
      });
    }
  }
  // Optional trigger info and recent channel history
  if (replyToInfo) messages.push({ role: "system", content: replyToInfo });
  if (channelHistory)
    messages.push({
      role: "system",
      content: `Recent channel history:\n${channelHistory}`,
    });
  // Markdown formatting guide
  messages.push({ role: "system", content: markdownGuide });

  // Flatten thread history into user message
  const lines: string[] = [];
  let cursor: string | undefined = currentId;
  while (cursor) {
    const turn = convoHistory.get(cursor);
    if (!turn) break;
    const clean = applyDiscordMarkdownFormatting(turn.content);
    lines.unshift(
      turn.role === "user" ? `${turn.name} asked: ${clean}` : clean
    );
    cursor = turn.replyToId;
  }
  // Append URLs
  for (const url of imageUrls) lines.push(`[image] ${url}`);
  for (const url of genericUrls) lines.push(`[link]  ${url}`);
  messages.push({ role: "user", content: lines.join("\n") });

  logger.info(`📝 Prompt → model=${modelName}, lines=${lines.length}`);
  logger.debug(`Prompt context: ${JSON.stringify(messages, null, 2)}`);

  // Invoke OpenAI
  let content: string;
  try {
    const res = await openai.chat.completions.create({
      model: modelName,
      messages,
      top_p: 0.6,
      frequency_penalty: 0.5,
      max_tokens: 2000,
    });
    content = res.choices[0]?.message.content?.trim() || "";
    if (!content) throw new Error("Empty AI response");
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

  // Extract and render LaTeX math blocks
  const mathBuffers: Buffer[] = [];
  for (const match of content.matchAll(/\\\[(.+?)\\\]/g)) {
    const expr = match[1].trim();
    try {
      const { buffer } = await renderMathToPng(expr);
      mathBuffers.push(buffer);
    } catch (e) {
      logger.warn("Math→PNG failed for expression:", expr, e);
    }
  }

  // Remove math blocks and collapse blank lines in reply
  let replyText = content.replace(/\\\[(.+?)\\\]/g, "");
  replyText = replyText.replace(/(\r?\n){2,}/g, "\n").trim();

  return { text: replyText, mathBuffers };
}
