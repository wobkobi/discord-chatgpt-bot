/**
 * @file src/services/replyService.ts
 * @description Builds the AI response prompt from conversation history and multimodal blocks,
 *   invokes OpenAI for chat completion, renders LaTeX math to PNG buffers, and returns cleaned
 *   reply text along with any generated math images.
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
 * A structured user message containing an array of multimodal blocks.
 */
export interface ChatCompletionBlockMessage {
  /** The role should always be 'user' for block messages. */
  role: "user";
  /** The sequence of content blocks (text, images, files). */
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
 * @returns A promise resolving to an object with the cleaned reply text and array of PNG buffers for rendered math.
 * @throws Will rethrow unexpected OpenAI errors after handling quota and model-not-found cases.
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
  // Feature toggles from environment
  const useFT = getRequired("USE_FINE_TUNED_MODEL") === "true";
  const usePersona = getRequired("USE_PERSONA") === "true";
  const modelName = useFT ? getRequired("FINE_TUNED_MODEL_NAME")! : "gpt-4o";

  // Build the system and user messages for OpenAI
  const messages: ChatCompletionMessageParam[] = [];

  // Persona/system prompt
  const persona = await getCharacterDescription(userId);
  messages.push({ role: "system", content: persona });

  // Long-term or clone memory
  if (usePersona || useFT) {
    const memArr =
      userId === cloneUserId
        ? cloneMemory.get(userId) || []
        : userMemory.get(userId) || [];
    if (memArr.length) {
      const prefix =
        userId === cloneUserId ? "Clone memory:" : "Long-term memory:";
      messages.push({
        role: "system",
        content: prefix + "\n" + memArr.map((e) => e.content).join("\n"),
      });
    }
  }

  // Optional context injections
  if (replyToInfo) messages.push({ role: "system", content: replyToInfo });
  if (channelHistory)
    messages.push({
      role: "system",
      content: `Recent channel history:\n${channelHistory}`,
    });
  messages.push({ role: "system", content: markdownGuide });

  // Assemble user blocks from history
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

  // Add new multimodal blocks and URLs
  userBlocks.push(...blocks);
  for (const url of genericUrls) {
    userBlocks.push({ type: "text", text: `[link] ${url}` });
  }

  // Wrap in ChatCompletionBlockMessage
  const blockMessage: ChatCompletionBlockMessage = {
    role: "user",
    content: userBlocks,
  };
  messages.push(blockMessage as unknown as ChatCompletionMessageParam);

  logger.info(`📝 Prompt → model=${modelName}, blocks=${userBlocks.length}`);
  logger.debug(`Prompt context: ${JSON.stringify(messages, null, 2)}`);

  // Call OpenAI chat completion
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

  // Render LaTeX math expressions to PNG buffers
  const mathBuffers: Buffer[] = [];
  for (const match of aiContent.matchAll(/\\\[(.+?)\\\]/g)) {
    try {
      const { buffer } = await renderMathToPng(match[1].trim());
      mathBuffers.push(buffer);
    } catch (e) {
      logger.warn("Math→PNG failed for:", match[1], e);
    }
  }

  // Remove LaTeX markers and collapse blank lines
  let replyText = aiContent.replace(/\\\[(.+?)\\\]/g, "");
  replyText = replyText.replace(/(\r?\n){2,}/g, "\n").trim();

  return { text: replyText, mathBuffers };
}
