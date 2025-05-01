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
 * Generate an AI reply, render any LaTeX blocks to images,
 * and return the cleaned text plus image buffers.
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
  // choose model
  const useFT = process.env.USE_FINE_TUNED_MODEL === "true";
  const modelName = useFT
    ? process.env.FINE_TUNED_MODEL_NAME ||
      (logger.error("FINE_TUNED_MODEL_NAME missing, exiting."),
      process.exit(1),
      "")
    : "gpt-4o";

  // build system+user prompt
  const messages: ChatCompletionMessageParam[] = [];
  if (process.env.USE_PERSONA === "true") {
    const persona = await getCharacterDescription(userId);
    messages.push({ role: "system", content: persona });
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

  // flatten thread into lines
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
  for (const url of imageUrls) lines.push(`[image] ${url}`);
  for (const url of genericUrls) lines.push(`[link]  ${url}`);
  messages.push({ role: "user", content: lines.join("\n") });

  logger.info(
    `📝 Prompt → model=${modelName}, lines=${lines.length}\n` +
      `Prompt context:\n${JSON.stringify(messages, null, 2)}`
  );

  // call OpenAI
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
    logger.error("OpenAI error:", err);
    if (err instanceof APIError && err.code === "insufficient_quota") {
      return { text: "⚠️ Out of quota.", mathBuffers: [] };
    }
    throw err;
  }

  // extract and render math
  const mathBuffers: Buffer[] = [];
  const mathMatches = Array.from(content.matchAll(/\\\[(.+?)\\\]/g));
  for (const m of mathMatches) {
    const expr = m[1].trim();
    try {
      const { buffer } = await renderMathToPng(expr);
      mathBuffers.push(buffer);
    } catch (e) {
      console.error("Math→PNG failed:", e);
    }
  }

  // remove all math blocks and collapse blank lines
  let replyText = content.replace(/\\\[(.+?)\\\]/g, "");
  replyText = replyText.replace(/(\r?\n){2,}/g, "\n").trim();

  return { text: replyText, mathBuffers };
}
