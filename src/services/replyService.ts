/**
 * @file src/services/replyService.ts
 * @description Assembles the AI prompt from conversation history and multimodal blocks,
 *   invokes OpenAI for chat completion, renders LaTeX maths to PNG buffers, and returns
 *   the cleaned reply text alongside any generated maths images.
 * @remarks
 *   - Leverages persona and memory stores
 *   - Applies Discord markdown formatting
 *   - Handles quota and model-not-found errors with graceful fallbacks
 *   - Emits detailed debug logs via `logger.debug` for each major step
 */

import { Block, ChatMessage } from "@/types";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { cloneMemory } from "../store/cloneMemory.js";
import { userMemory } from "../store/userMemory.js";
import { applyDiscordMarkdownFormatting } from "../utils/discordHelpers.js";
import { getRequired } from "../utils/env.js";
import { loadUserMemory } from "../utils/fileUtils.js";
import { renderMathToPng } from "../utils/latexRenderer.js";
import logger from "../utils/logger.js";
import {
  cloneUserId,
  getCharacterDescription,
  getSystemMetadata,
} from "./characterService.js";

/**
 * A ChatGPT block message, containing an array of multimodal content.
 */
export interface ChatCompletionBlockMessage {
  /** Always 'user' for user-sourced blocks. */
  role: "user";
  /** Sequence of text, image or file blocks to feed into the model. */
  content: Block[];
}

/**
 * Generate an AI reply given the conversation context and extracted inputs.
 *
 * @param convoHistory   Map of message IDs to ChatMessage objects for the current thread.
 * @param currentId      Discord message ID of the latest user message.
 * @param openai         Initialized OpenAI client instance.
 * @param userId         Discord user ID, used to select persona and memory.
 * @param channelHistory Optional recent channel messages (with timestamps).
 * @param blocks         Pre-extracted multimodal blocks (text, images, files).
 * @param genericUrls    Remaining URLs to include as text blocks.
 * @returns              Promise resolving to reply text and any maths image buffers.
 * @throws               Re-throws unexpected OpenAI errors after handling known cases.
 */
export async function generateReply(
  convoHistory: Map<string, ChatMessage>,
  currentId: string,
  openai: OpenAI,
  userId: string,
  channelHistory?: string,
  blocks: Block[] = [],
  genericUrls: string[] = []
): Promise<{ text: string; mathBuffers: Buffer[] }> {
  logger.debug(
    `[replyService] generateReply invoked (userId=${userId}, currentId=${currentId})`
  );

  // Helper to strip mentions and custom emotes, retaining emote names
  const sanitiseInput = (text: string): string =>
    text
      .replace(/<@!?\d+>/g, "") // remove user/bot mentions
      .replace(/<@&\d+>/g, "") // remove role mentions
      .replace(/<a?:(\w+):\d+>/g, "$1") // keep emote name
      .trim();

  // Load long-term memory if not in cache
  if (!userMemory.has(userId)) {
    try {
      const memEntries = await loadUserMemory(userId);
      userMemory.set(userId, memEntries);
      logger.debug(
        `[replyService] Loaded ${memEntries.length} memory entries for userId=${userId}`
      );
    } catch (err) {
      logger.error(
        `[replyService] Failed to load memory for userId=${userId}:`,
        err
      );
    }
  }

  // Feature toggles and model selection
  const useFT = getRequired("USE_FINE_TUNED_MODEL") === "true";
  const usePersona = getRequired("USE_PERSONA") === "true";
  const modelName = useFT ? getRequired("FINE_TUNED_MODEL_NAME")! : "gpt-4o";
  logger.debug(
    `[replyService] Config ➞ useFT=${useFT}, usePersona=${usePersona}, model=${modelName}`
  );

  const messages: ChatCompletionMessageParam[] = [];

  // Sanitise incoming blocks
  blocks.forEach((blk) => {
    if (blk.type === "text") blk.text = sanitiseInput(blk.text);
  });

  // Persona prompt (if enabled)
  if (usePersona) {
    const personaPrompt = await getCharacterDescription(userId);
    messages.push({
      role: "system",
      content: sanitiseInput(personaPrompt),
    });
    logger.debug("[replyService] Added persona prompt");
  }

  // Always inject timestamp and markdown guide
  const systemMeta = getSystemMetadata();
  messages.push({
    role: "system",
    content: sanitiseInput(systemMeta),
  });
  logger.debug("[replyService] Added system metadata");

  // Long-term or clone memory (concise, recent entries)
  const rawMem =
    userId === cloneUserId
      ? cloneMemory.get(userId) || []
      : userMemory.get(userId) || [];
  if (rawMem.length) {
    const entries = rawMem.map((e) => sanitiseInput(e.content));
    const prefix =
      userId === cloneUserId ? "Clone memory:" : "Long-term memory:";
    const maxEntries = 15;
    const sliceStart = Math.max(entries.length - maxEntries, 0);
    const subset = entries.slice(sliceStart);
    const omitted = entries.length - subset.length;
    const header =
      omitted > 0
        ? `${prefix} (showing ${subset.length}/${entries.length}; ${omitted} omitted)`
        : prefix;
    messages.push({
      role: "system",
      content: header + "\n" + subset.join("\n"),
    });
    logger.debug(
      `[replyService] Added memory block (${subset.length}/${entries.length})`
    );
  }

  // Channel history, if provided
  if (channelHistory) {
    messages.push({
      role: "system",
      content: `Recent channel history:\n${sanitiseInput(channelHistory)}`,
    });
    logger.debug("[replyService] Added channel history");
  }

  // Reconstruct user thread history (only user turns)
  const userBlocks: Block[] = [];
  let cursor: string | undefined = currentId;
  while (cursor) {
    const turn = convoHistory.get(cursor);
    if (!turn) break;
    if (turn.role === "user") {
      const cleaned = sanitiseInput(
        applyDiscordMarkdownFormatting(turn.content)
      );
      userBlocks.unshift({
        type: "text",
        text: `${turn.name} asked: ${cleaned}`,
      });
    }
    cursor = turn.replyToId;
  }
  logger.debug(
    `[replyService] Reconstructed ${userBlocks.length} user history blocks`
  );

  // Append new blocks and any leftover URLs
  userBlocks.push(...blocks);
  genericUrls.forEach((url) => {
    userBlocks.push({
      type: "text",
      text: sanitiseInput(`[link] ${url}`),
    });
  });
  logger.debug(
    `[replyService] Total user multimodal blocks: ${userBlocks.length}`
  );

  messages.push({
    role: "user",
    content: userBlocks,
  } as unknown as ChatCompletionMessageParam);

  // OpenAI completion
  let contentText: string;
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
    contentText = res.choices[0]?.message.content?.trim() || "";
    if (!contentText) throw new Error("Empty AI response");
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

  // Log token usage
  const { usage } = res;
  logger.info(
    `📝 Prompt tokens: ${usage?.prompt_tokens ?? "?"}, completion tokens: ${usage?.completion_tokens ?? "?"}`
  );

  // Render all LaTeX formulas to PNG buffers
  const mathBuffers: Buffer[] = [];
  const formulaRegex =
    /```(?:latex)?\s*([\s\S]+?)\s*```|\\\[(.+?)\\\]|\\$\\$(.+?)\\$\\$/gs;
  for (const match of contentText.matchAll(formulaRegex)) {
    const tex = (match[1] || match[2] || match[3] || "").trim();
    try {
      const { buffer } = await renderMathToPng(tex);
      mathBuffers.push(buffer);
    } catch (err) {
      logger.warn("[replyService] Maths→PNG failed for:", tex, err);
    }
  }

  // Strip formulas from reply text
  const replyText = contentText
    .replace(formulaRegex, "")
    .replace(/(\r?\n){2,}/g, "\n")
    .trim();
  logger.debug(`[replyService] Final reply text length=${replyText.length}`);

  return { text: replyText, mathBuffers };
}
