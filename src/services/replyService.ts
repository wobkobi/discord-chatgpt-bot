/**
 * @file src/services/replyService.ts
 * @description Assembles the AI prompt from conversation history and multimodal blocks,
 *   invokes OpenAI for chat completion, renders LaTeX maths to PNG buffers, and returns
 *   the cleaned reply text alongside any generated maths images.
 */

import {
  cloneUserId,
  getCharacterDescription,
  getSystemMetadata,
  markdownGuide,
} from "@/services/characterService.js";
import { cloneMemory } from "@/store/cloneMemory.js";
import { userMemory } from "@/store/userMemory.js";
import { Block, ChatCompletionBlockMessage } from "@/types/block.js";
import { ChatMessage } from "@/types/chat.js";
import { applyDiscordMarkdownFormatting } from "@/utils/discordHelpers.js";
import { getOptional, getRequired } from "@/utils/env.js";
import { loadUserMemory } from "@/utils/fileUtils.js";
import { renderMathToPng } from "@/utils/latexRenderer.js";
import logger from "@/utils/logger.js";
import { resolveGifPlaceholders, resolveTenorLinks } from "@/utils/tenorResolver.js";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";

const MAX_MEMORY_ENTRIES = parseInt(getOptional("MAX_MEMORY_ENTRIES") || "50", 10);

/**
 * Strip bot/user mentions and custom emotes from text, keeping only names.
 * @param text - Raw user or system text to sanitize.
 * @returns Cleaned text with mentions removed.
 */
function sanitiseInput(text: string): string {
  return text
    .replace(/<@!?\d+>/g, "")
    .replace(/<@&\d+>/g, "")
    .replace(/<a?:(\w+):\d+>/g, "$1")
    .trim();
}

/**
 * Generate an AI reply given the conversation context and extracted inputs.
 * @param convoHistory - Map of message IDs to ChatMessage for the current thread.
 * @param currentId - Discord message ID of the latest user message.
 * @param openai - Initialized OpenAI client instance.
 * @param userId - Discord user ID (used for persona and memory selection).
 * @param channelHistory - Optional recent channel messages string (timestamped).
 * @param blocks - Pre-extracted multimodal blocks (text, images, files).
 * @param genericUrls - Remaining URLs to include as text blocks.
 * @returns Promise resolving to `{ text, mathBuffers }`.
 */
export async function generateReply(
  convoHistory: Map<string, ChatMessage>,
  currentId: string,
  openai: OpenAI,
  userId: string,
  channelHistory?: string,
  blocks: Block[] = [],
  genericUrls: string[] = [],
): Promise<{ text: string; mathBuffers: Buffer[] }> {
  if (!userMemory.has(userId)) {
    try {
      userMemory.set(userId, await loadUserMemory(userId));
    } catch (err) {
      logger.error(`[replyService] Failed to load memory for userId=${userId}:`, err);
    }
  }

  const useFT = getOptional("USE_FINE_TUNED_MODEL") === "true";
  const usePersona = getOptional("USE_PERSONA") === "true";
  const ftVision = getOptional("FINE_TUNED_SUPPORTS_VISION") === "true";
  const modelName = useFT ? getRequired("FINE_TUNED_MODEL_NAME") : "gpt-4o";

  const messages: Array<ChatCompletionMessageParam | ChatCompletionBlockMessage> = [];

  // Static system messages first; identical across calls so OpenAI can prompt-cache them
  if (usePersona) {
    messages.push({
      role: "system",
      content: sanitiseInput(await getCharacterDescription(userId)),
    });
  }
  const useMarkdownGuide = getOptional("USE_MARKDOWN_GUIDE", "true") !== "false";
  if (useMarkdownGuide) messages.push({ role: "system", content: markdownGuide });
  if (getOptional("TENOR_API_KEY")) {
    messages.push({
      role: "system",
      content:
        "You can include a GIF in your response using [GIF: keywords]. Example: [GIF: happy dancing]. Use short descriptive keywords. Only include one GIF per message, and only when it adds to the response.",
    });
  }
  // Dynamic: timestamp changes every call, kept separate so the static messages above stay cacheable
  messages.push({ role: "system", content: getSystemMetadata() });

  const rawMem = (userId === cloneUserId ? cloneMemory.get(userId) : userMemory.get(userId)) ?? [];
  const memToUse = rawMem.slice(-MAX_MEMORY_ENTRIES);
  if (memToUse.length) {
    const prefix = userId === cloneUserId ? "Clone memory:" : "Long-term memory:";
    messages.push({
      role: "system",
      content: `${prefix}\n${memToUse.map((e) => sanitiseInput(e.content)).join("\n")}`,
    });
  }

  // Channel history is only useful as orientation on a fresh thread
  if (channelHistory && convoHistory.size <= 1) {
    messages.push({
      role: "system",
      content: `Recent channel history:\n${sanitiseInput(channelHistory)}`,
    });
  }

  // Build prior turns with proper user/assistant alternation
  const currentTurn = convoHistory.get(currentId);
  const priorChain: Array<{ role: "user" | "assistant"; content: string }> = [];
  let cursor = currentTurn?.replyToId;
  while (cursor) {
    const turn = convoHistory.get(cursor);
    if (!turn) break;
    const cleaned = sanitiseInput(applyDiscordMarkdownFormatting(turn.content));
    priorChain.unshift({
      role: turn.role as "user" | "assistant",
      content: turn.role === "user" ? `${turn.name} asked: ${cleaned}` : cleaned,
    });
    cursor = turn.replyToId;
  }
  for (const { role, content } of priorChain) {
    messages.push({ role, content } as ChatCompletionMessageParam);
  }

  // Current turn: multimodal for gpt-4o, text-only for fine-tuned models which may lack vision
  const currentText = currentTurn
    ? sanitiseInput(applyDiscordMarkdownFormatting(currentTurn.content))
    : "";
  const currentContent: Block[] = [
    ...(currentText
      ? [{ type: "text" as const, text: `${currentTurn?.name} asked: ${currentText}` }]
      : []),
    ...(useFT && !ftVision ? blocks.filter((b) => b.type === "text") : blocks),
    ...genericUrls.map((url) => ({ type: "text" as const, text: sanitiseInput(`[link] ${url}`) })),
  ];
  messages.push({ role: "user", content: currentContent } as ChatCompletionBlockMessage);

  logger.info(
    `📝 Prompt → model=${modelName}, blocks=${currentContent.length}, thread depth=${convoHistory.size}`,
  );

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

    logger.info(
      `📝 Prompt tokens: ${res.usage?.prompt_tokens ?? "?"}, completion tokens: ${res.usage?.completion_tokens ?? "?"}`,
    );
  } catch (err: unknown) {
    if (useFT && err instanceof APIError && err.code === "model_not_found") {
      logger.error(
        `[replyService] Fine-tuned model not found: ${modelName} — falling back to gpt-4o`,
      );
      return generateReply(
        convoHistory,
        currentId,
        openai,
        userId,
        channelHistory,
        blocks,
        genericUrls,
      );
    }
    logger.error("[replyService] OpenAI error:", err);
    if (err instanceof APIError && err.code === "insufficient_quota") {
      return { text: "⚠️ The assistant is out of quota.", mathBuffers: [] };
    }
    return { text: "⚠️ Sorry, I couldn't complete that request right now.", mathBuffers: [] };
  }

  const mathBuffers: Buffer[] = [];
  const formulaRegex =
    /```(?:latex)?\s*([\s\S]+?)\s*```|\\\[(.+?)\\\]|\\\((.+?)\\\)|\$\$([\s\S]+?)\$\$/gs;
  for (const match of contentText.matchAll(formulaRegex)) {
    const tex = (match[1] || match[2] || match[3] || match[4] || "").trim();
    try {
      const { buffer } = await renderMathToPng(tex);
      mathBuffers.push(buffer);
    } catch (err) {
      logger.warn("[replyService] Math→PNG failed for:", tex, err);
    }
  }

  const strippedText = contentText
    .replace(formulaRegex, "")
    .replace(/(\r?\n){2,}/g, "\n")
    .trim();

  let replyText = strippedText;
  try {
    replyText = await resolveGifPlaceholders(replyText);
  } catch (err) {
    logger.warn("[replyService] GIF placeholder resolution failed:", err);
  }
  try {
    replyText = await resolveTenorLinks(replyText);
  } catch (err) {
    logger.warn("[replyService] Tenor resolution failed:", err);
  }
  return { text: replyText, mathBuffers };
}
