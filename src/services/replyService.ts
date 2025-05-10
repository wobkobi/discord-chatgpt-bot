/**
 * @file src/services/replyService.ts
 * @description Assembles the AI prompt from conversation history and multimodal blocks,
 *   invokes OpenAI for chat completion, renders LaTeX maths to PNG buffers, and returns
 *   the cleaned reply text alongside any generated maths images.
 *
 *   - Leverages persona and memory stores
 *   - Applies Discord markdown formatting
 *   - Handles quota, model-not-found, and generic errors with graceful fallbacks
 *   - Emits detailed debug logs for each major step
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
 * Maximum number of memory entries to include in the prompt.
 */
const MAX_MEMORY_ENTRIES = parseInt(getRequired("MAX_MEMORY_ENTRIES"), 10);

/**
 * A ChatGPT message that may carry multiple block contents.
 */
export interface ChatCompletionBlockMessage {
  role: "user";
  content: Block[];
}

/**
 * Generate an AI reply given the conversation context and extracted inputs.
 * @param convoHistory   Map of message IDs to ChatMessage objects for the current thread.
 * @param currentId      Discord message ID of the latest user message.
 * @param openai         Initialized OpenAI client instance.
 * @param userId         Discord user ID, used to select persona and memory.
 * @param channelHistory Optional recent channel messages (with timestamps).
 * @param blocks         Pre-extracted multimodal blocks (text, images, files).
 * @param genericUrls    Remaining URLs to include as text blocks.
 * @returns              Promise resolving to reply text and any maths image buffers.
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

  /**
   * Strip mentions and custom emotes, retaining emote names.
   * @param text - The raw message content to sanitize.
   * @returns The sanitized string with mentions and emote tags removed.
   */
  const sanitiseInput = (text: string): string =>
    text
      .replace(/<@!?\d+>/g, "")
      .replace(/<@&\d+>/g, "")
      .replace(/<a?:(\w+):\d+>/g, "$1")
      .trim();

  /**
   * Ensure long-term memory is loaded for this user.
   */
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

  /**
   * Feature toggles and model selection.
   */
  const useFT = getRequired("USE_FINE_TUNED_MODEL") === "true";
  const usePersona = getRequired("USE_PERSONA") === "true";
  const modelName = useFT ? getRequired("FINE_TUNED_MODEL_NAME")! : "gpt-4o";
  logger.debug(
    `[replyService] Config → useFT=${useFT}, usePersona=${usePersona}, model=${modelName}`
  );

  /**
   * Sequence of messages for the chat completion API.
   */
  const messages: Array<
    ChatCompletionMessageParam | ChatCompletionBlockMessage
  > = [];

  /**
   * Persona prompt (if enabled).
   */
  if (usePersona) {
    const personaPrompt = await getCharacterDescription(userId);
    messages.push({
      role: "system",
      content: sanitiseInput(personaPrompt),
    });
    logger.debug("[replyService] Added persona prompt");
  }

  /**
   * System metadata (timestamp and markdown guide).
   */
  const systemMeta = getSystemMetadata();
  messages.push({
    role: "system",
    content: sanitiseInput(systemMeta),
  });
  logger.debug("[replyService] Added system metadata");

  /**
   * Clone- or user-specific memory block, limited to max entries.
   */
  const rawMem =
    userId === cloneUserId
      ? cloneMemory.get(userId) || []
      : userMemory.get(userId) || [];
  const memToUse = rawMem.slice(-MAX_MEMORY_ENTRIES);
  if (memToUse.length) {
    const entries = memToUse.map((e) => sanitiseInput(e.content));
    const prefix =
      userId === cloneUserId ? "Clone memory:" : "Long-term memory:";
    messages.push({
      role: "system",
      content: `${prefix}\n${entries.join("\n")}`,
    });
    logger.debug(
      `[replyService] Added memory block (${entries.length} entries)`
    );
  }

  /**
   * Optional channel history.
   */
  if (channelHistory) {
    messages.push({
      role: "system",
      content: `Recent channel history:\n${sanitiseInput(channelHistory)}`,
    });
    logger.debug("[replyService] Added channel history");
  }

  /**
   * Construct user blocks from conversation history and inputs.
   */
  const userBlocks: Block[] = [];
  let cursor: string | undefined = currentId;
  while (cursor) {
    const turn = convoHistory.get(cursor);
    if (!turn) break;
    const cleaned = applyDiscordMarkdownFormatting(turn.content);
    if (turn.role === "user") {
      userBlocks.unshift({
        type: "text",
        text: `${turn.name} asked: ${sanitiseInput(cleaned)}`,
      });
    }
    cursor = turn.replyToId;
  }
  userBlocks.push(...blocks);
  for (const url of genericUrls) {
    userBlocks.push({ type: "text", text: sanitiseInput(`[link] ${url}`) });
  }
  // Push block message without using `any`
  messages.push({ role: "user", content: userBlocks });
  logger.info(
    `📝 Prompt → model=${modelName}, total user blocks=${userBlocks.length}`
  );

  /**
   * Call OpenAI completion with error handling.
   */
  let contentText: string;
  try {
    const res = await openai.chat.completions.create({
      model: modelName,
      messages: messages as unknown as ChatCompletionMessageParam[],
      temperature: 0.7,
      top_p: 0.8,
      frequency_penalty: 0.3,
      presence_penalty: 0.1,
      max_tokens: 512,
      user: userId,
    });
    contentText = res.choices[0]?.message.content?.trim() || "";
    if (!contentText) throw new Error("Empty AI response");

    // Log token usage for prompt and completion
    logger.info(
      `📝 Prompt tokens: ${res.usage?.prompt_tokens ?? "?"}, completion tokens: ${res.usage?.completion_tokens ?? "?"}`
    );
  } catch (err: unknown) {
    if (useFT && err instanceof APIError && err.code === "model_not_found") {
      logger.error(`Fine-tuned model not found: ${modelName}`);
      process.exit(1);
    }
    logger.error("[replyService] OpenAI error:", err);
    if (err instanceof APIError && err.code === "insufficient_quota") {
      return { text: "⚠️ The assistant is out of quota.", mathBuffers: [] };
    }
    return {
      text: "⚠️ Sorry, I couldn’t complete that request right now.",
      mathBuffers: [],
    };
  }

  /**
   * Render any LaTeX formulas to PNG buffers.
   */
  const mathBuffers: Buffer[] = [];
  const formulaRegex =
    /```(?:latex)?\s*([\s\S]+?)\s*```|\\\[(.+?)\\\]|\\\$\\\$(.+?)\\\$\\\$/gs;
  for (const match of contentText.matchAll(formulaRegex)) {
    const tex = (match[1] || match[2] || match[3] || "").trim();
    try {
      const { buffer } = await renderMathToPng(tex);
      mathBuffers.push(buffer);
    } catch (err) {
      logger.warn("[replyService] Math→PNG failed for:", tex, err);
    }
  }

  /**
   * Clean up reply text by stripping formulas and collapsing blank lines.
   */
  const replyText = contentText
    .replace(formulaRegex, "")
    .replace(/(\r?\n){2,}/g, "\n")
    .trim();

  return { text: replyText, mathBuffers };
}
