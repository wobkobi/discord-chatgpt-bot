/**
 * @file src/services/replyService.ts
 * @description Assembles the AI prompt from conversation history and multimodal blocks,
 *   invokes OpenAI for chat completion, renders LaTeX maths to PNG buffers, and returns
 *   the cleaned reply text alongside any generated maths images.
 *
 * Only injects persona/metadata/memory on the first turn of a thread (when convoHistory.size ≤ 1).
 * On existing reply chains (convoHistory.size > 1), only sends the new user messages.
 * Renders any LaTeX formulas into PNG buffers for Discord display.
 */

import { Block, ChatMessage } from "@/types";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { cloneMemory } from "../store/cloneMemory.js";
import { userMemory } from "../store/userMemory.js";
import { applyDiscordMarkdownFormatting } from "../utils/discordHelpers.js";
import { getOptional, getRequired } from "../utils/env.js";
import { loadUserMemory } from "../utils/fileUtils.js";
import { renderMathToPng } from "../utils/latexRenderer.js";
import logger from "../utils/logger.js";
import {
  cloneUserId,
  getCharacterDescription,
  getSystemMetadata,
} from "./characterService.js";

/**
 * MAX_MEMORY_ENTRIES
 * Maximum number of memory entries to include in the prompt (defaults to 50).
 */
const MAX_MEMORY_ENTRIES = parseInt(
  getOptional("MAX_MEMORY_ENTRIES") ?? "50",
  10
);

/**
 * A ChatGPT message type that carries multiple block‐style contents.
 */
export interface ChatCompletionBlockMessage {
  role: "user";
  content: Block[];
}

/**
 * Generate an AI reply given the conversation context and extracted inputs.
 *
 * If convoHistory.size ≤ 1, this is a “new thread”: persona, system metadata,
 * and long-term memory blocks will be injected first.
 * If convoHistory.size > 1, this is a follow-up turn: we skip persona/metadata/memory
 * and only send the accumulated user messages.
 * @param convoHistory   Map of message IDs → ChatMessage for the current thread.
 * @param currentId      Discord message ID of the latest user message.
 * @param openai         Initialized OpenAI client instance.
 * @param userId         Discord user ID (used for selecting persona & memory).
 * @param channelHistory Optional string of recent channel messages (timestamped).
 * @param blocks         Pre-extracted multimodal blocks (text, images, files).
 * @param genericUrls    Remaining URLs to include as text blocks.
 * @returns              Promise resolving to { text, mathBuffers }.
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
    `[replyService] generateReply invoked (userId=${userId}, currentId=${currentId}, historySize=${convoHistory.size})`
  );

  // If ≤1 message in convoHistory (i.e. first turn of a thread), treat as a new thread
  const isNewThread = convoHistory.size <= 1;

  /**
   * Strip mentions & custom emotes, keeping only names.
   * @param text  Raw user or system text to sanitize.
   * @returns     Cleaned text with bot/user mentions removed.
   */
  const sanitiseInput = (text: string): string =>
    text
      .replace(/<@!?\d+>/g, "")
      .replace(/<@&\d+>/g, "")
      .replace(/<a?:(\w+):\d+>/g, "$1")
      .trim();

  // Load long-term memory for this user (only once)
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

  // Feature toggles & model selection
  const useFT = getRequired("USE_FINE_TUNED_MODEL") === "true";
  const usePersona = getRequired("USE_PERSONA") === "true";
  const modelName = useFT ? getRequired("FINE_TUNED_MODEL_NAME")! : "gpt-4o";
  logger.debug(
    `[replyService] Config → useFT=${useFT}, usePersona=${usePersona}, model=${modelName}`
  );

  // Build messages array for OpenAI
  const messages: Array<
    ChatCompletionMessageParam | ChatCompletionBlockMessage
  > = [];

  if (isNewThread) {
    // Persona prompt (if enabled)
    if (usePersona) {
      const personaPrompt = await getCharacterDescription(userId);
      messages.push({
        role: "system",
        content: sanitiseInput(personaPrompt),
      });
      logger.debug("[replyService] Added persona prompt");
    }

    // System metadata (timestamp, markdown guide)
    const systemMeta = getSystemMetadata();
    messages.push({
      role: "system",
      content: sanitiseInput(systemMeta),
    });
    logger.debug("[replyService] Added system metadata");

    // Clone/user memory (up to MAX_MEMORY_ENTRIES)
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

    // Optional channel history
    if (channelHistory) {
      messages.push({
        role: "system",
        content: `Recent channel history:\n${sanitiseInput(channelHistory)}`,
      });
      logger.debug("[replyService] Added channel history");
    }
  }

  // Always append the new user turn (text + blocks + generic URLs)
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
  messages.push({ role: "user", content: userBlocks });

  logger.info(
    `📝 Prompt → model=${modelName}, user blocks=${userBlocks.length}, newThread=${isNewThread}`
  );

  // Call OpenAI with higher variance settings
  let contentText: string;
  try {
    const res = await openai.chat.completions.create({
      model: modelName,
      messages: messages as unknown as ChatCompletionMessageParam[],
      temperature: 0.9,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      max_tokens: 512,
      user: userId,
    });

    contentText = res.choices[0]?.message.content?.trim() || "";
    if (!contentText) throw new Error("Empty AI response");

    // Log token usage
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

  // Render any LaTeX formulas to PNG buffers
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

  // Strip formulas from text and collapse blank lines
  const replyText = contentText
    .replace(formulaRegex, "")
    .replace(/(\r?\n){2,}/g, "\n")
    .trim();

  return { text: replyText, mathBuffers };
}
