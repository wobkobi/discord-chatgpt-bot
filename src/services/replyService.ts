// src/services/replyService.ts
/**
 * @description Assembles the AI prompt from conversation history and multimodal blocks,
 *   invokes OpenAI for chat completion, renders LaTeX maths to PNG buffers, and returns
 *   the cleaned reply text alongside any generated maths images.
 */

import {
  cloneUserId,
  getCharacterDescription,
  getSystemMetadata,
  markdownGuide,
} from "@/services/characterService";
import { cloneMemory } from "@/store/cloneMemory";
import { userMemory } from "@/store/userMemory";
import { Block, ChatCompletionBlockMessage } from "@/types/block";
import { ChatMessage } from "@/types/chat";
import { applyDiscordMarkdownFormatting } from "@/utils/discordHelpers";
import { getOptional, getRequired } from "@/utils/env";
import { loadUserMemory } from "@/utils/fileUtils";
import { hasUnresolvedGif, resolveGifLinks, resolveGifPlaceholders } from "@/utils/gifResolver";
import { renderMathToPng } from "@/utils/latexRenderer";
import logger from "@/utils/logger";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";

const MAX_MEMORY_ENTRIES = parseInt(getOptional("MAX_MEMORY_ENTRIES") || "50", 10);

/**
 * Total completions allowed per reply. A reply that references a GIF which cannot be
 * verified is re-rolled rather than shipped with a dead link; on the final attempt the
 * unresolved reference is stripped instead so the user still gets an answer.
 */
const MAX_GIF_ATTEMPTS = 3;

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

/** Error codes OpenAI uses when the account cannot pay for the request. */
const BILLING_ERROR_CODES = new Set([
  "insufficient_quota",
  "billing_hard_limit_reached",
  "billing_not_active",
  "account_deactivated",
]);

/** Node/undici socket codes seen when the request never reaches OpenAI. */
const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Thrown when a completion comes back with no content; matched again when classifying. */
const EMPTY_RESPONSE = "Empty AI response";

/** Shown when the failure matches none of the recognised cases. */
const GENERIC_FAILURE_TEXT = "⚠️ Sorry, I couldn't complete that request right now.";

/** Fields worth reading off a failed request, flattened from the several error shapes. */
interface ApiFailure {
  status: number;
  code: string;
  type: string;
  message: string;
}

/**
 * Flatten a thrown value into the fields used to classify it.
 *
 * The shape is read directly rather than narrowed with `instanceof APIError`, which fails
 * whenever a second copy of the SDK is resolved anywhere in the tree. `cause.code` is
 * picked up as a fallback because undici socket failures carry their code there.
 * @param err - Value thrown by the OpenAI client.
 * @returns Status, code, type and message, zeroed or blank where absent.
 */
function toApiFailure(err: unknown): ApiFailure {
  if (typeof err !== "object" || err === null) {
    return { status: 0, code: "", type: "", message: String(err) };
  }
  const { status, code, type, message, cause } = err as Record<string, unknown>;
  const causeCode =
    typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return {
    status: typeof status === "number" ? status : 0,
    code: typeof code === "string" ? code : typeof causeCode === "string" ? causeCode : "",
    type: typeof type === "string" ? type : "",
    message: typeof message === "string" ? message : "",
  };
}

/**
 * Failures worth explaining to the user, tested in order - the first match wins.
 *
 * Billing sits above rate limiting because a spent balance and an ordinary throttle both
 * arrive as 429 and are told apart only by the code or the wording. Network faults sit
 * near the bottom because they are identified by a missing status rather than a code, so
 * anything carrying a real HTTP status should have been claimed already.
 */
const KNOWN_FAILURES: ReadonlyArray<{
  reason: string;
  test: (failure: ApiFailure) => boolean;
  text: string;
}> = [
  {
    reason: "empty completion",
    test: (f) => f.message === EMPTY_RESPONSE,
    text: "⚠️ OpenAI sent back an empty reply - ask me again.",
  },
  {
    reason: "out of credit",
    test: (f) =>
      BILLING_ERROR_CODES.has(f.code) ||
      BILLING_ERROR_CODES.has(f.type) ||
      /insufficient[_ ]quota|exceeded your current quota|billing/i.test(f.message),
    text: "⚠️ I'm out of OpenAI credit - fill my belly with more money then i might reply again.",
  },
  {
    reason: "rejected API key",
    test: (f) => f.status === 401 || f.code === "invalid_api_key",
    text: "⚠️ My OpenAI key got rejected - it needs replacing before I can reply.",
  },
  {
    reason: "model or region not permitted",
    test: (f) =>
      f.status === 403 ||
      f.status === 404 ||
      f.code === "model_not_found" ||
      f.code === "unsupported_country_region_territory",
    text: "⚠️ My OpenAI account isn't allowed to use that model.",
  },
  {
    reason: "context too long",
    test: (f) =>
      f.code === "context_length_exceeded" ||
      f.code === "string_above_max_length" ||
      /maximum context length/i.test(f.message),
    text: "⚠️ This thread got too long for me to process - start a fresh one and I'll be fine.",
  },
  {
    reason: "content policy",
    test: (f) =>
      f.code === "content_policy_violation" ||
      f.code === "content_filter" ||
      /content[_ ]policy|safety system/i.test(f.message),
    text: "⚠️ OpenAI blocked that one on content policy - try wording it differently.",
  },
  {
    reason: "unreadable attachment",
    test: (f) =>
      f.code === "invalid_image_url" ||
      f.code === "image_parse_error" ||
      f.code === "invalid_base64_image" ||
      /invalid image|unsupported image|could not process image/i.test(f.message),
    text: "⚠️ I couldn't read one of those attachments - try re-uploading it.",
  },
  {
    reason: "rate limited",
    test: (f) => f.status === 429 || f.code === "rate_limit_exceeded",
    text: "⚠️ OpenAI is rate limiting me - give it a moment and ask again.",
  },
  {
    reason: "network fault",
    test: (f) =>
      NETWORK_ERROR_CODES.has(f.code) ||
      (f.status === 0 && /connection error|timed out|timeout|fetch failed|socket/i.test(f.message)),
    text: "⚠️ I couldn't reach OpenAI - the connection dropped. Try again in a bit.",
  },
  {
    reason: "OpenAI server error",
    test: (f) => f.status >= 500 || f.code === "server_error" || /overloaded/i.test(f.message),
    text: "⚠️ OpenAI is having problems on their end - try again shortly.",
  },
];

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
  if (getOptional("GIPHY_API_KEY")) {
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

  // Single completion call, parameterised by model so the fallback can retry explicitly
  const requestCompletion = (model: string): Promise<OpenAI.Chat.Completions.ChatCompletion> =>
    openai.chat.completions.create({
      model,
      messages: messages as unknown as ChatCompletionMessageParam[],
      temperature: 0.9,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      max_tokens: 512,
      user: userId,
    });

  const formulaRegex =
    /```(?:latex)?\s*([\s\S]+?)\s*```|\\\[(.+?)\\\]|\\\((.+?)\\\)|\$\$([\s\S]+?)\$\$/gs;

  let replyText = "";
  let mathBuffers: Buffer[] = [];

  // A reply naming a GIF that will not verify is re-rolled from scratch. Sampling is
  // stochastic (temperature 0.9), so a fresh completion usually picks different - and
  // searchable - keywords. The last attempt strips instead of retrying, so the loop
  // always terminates with something sendable.
  for (let attempt = 1; attempt <= MAX_GIF_ATTEMPTS; attempt++) {
    const isFinalAttempt = attempt === MAX_GIF_ATTEMPTS;

    let contentText: string;
    try {
      let res;
      try {
        res = await requestCompletion(modelName);
      } catch (err: unknown) {
        // Retry once on the base model - recursing into generateReply re-selects the
        // same missing fine-tuned model from env and loops forever
        if (useFT && err instanceof APIError && err.code === "model_not_found") {
          logger.error(
            `[replyService] Fine-tuned model not found: ${modelName} - falling back to gpt-4o`,
          );
          res = await requestCompletion("gpt-4o");
        } else {
          throw err;
        }
      }

      contentText = res.choices[0]?.message.content?.trim() || "";
      if (!contentText) throw new Error(EMPTY_RESPONSE);

      logger.info(
        `📝 Prompt tokens: ${res.usage?.prompt_tokens ?? "?"}, completion tokens: ${res.usage?.completion_tokens ?? "?"}`,
      );
    } catch (err: unknown) {
      const failure = toApiFailure(err);
      const known = KNOWN_FAILURES.find((entry) => entry.test(failure));
      // Winston's printf drops splat args, so the fields have to be in the message itself
      logger.error(
        `[replyService] OpenAI call failed (${known?.reason ?? "unclassified"}): status=${failure.status || "-"} code=${failure.code || "-"} type=${failure.type || "-"} message=${failure.message}`,
      );
      // An unrecognised failure is the only one whose stack is worth the log noise
      if (!known && err instanceof Error && err.stack) logger.error(err.stack);
      return { text: known?.text ?? GENERIC_FAILURE_TEXT, mathBuffers: [] };
    }

    const buffers: Buffer[] = [];
    for (const match of contentText.matchAll(formulaRegex)) {
      const tex = (match[1] || match[2] || match[3] || match[4] || "").trim();
      try {
        const { buffer } = await renderMathToPng(tex);
        buffers.push(buffer);
      } catch (err) {
        logger.warn("[replyService] Math→PNG failed for:", tex, err);
      }
    }

    let text = contentText
      .replace(formulaRegex, "")
      .replace(/(\r?\n){2,}/g, "\n")
      .trim();

    try {
      text = await resolveGifPlaceholders(text, isFinalAttempt);
    } catch (err) {
      logger.warn("[replyService] GIF placeholder resolution failed:", err);
    }
    try {
      text = await resolveGifLinks(text, isFinalAttempt);
    } catch (err) {
      logger.warn("[replyService] GIF link resolution failed:", err);
    }

    replyText = text;
    mathBuffers = buffers;

    if (!hasUnresolvedGif(replyText)) break;
    logger.warn(
      `[replyService] Unverified GIF in reply - re-rolling (attempt ${attempt}/${MAX_GIF_ATTEMPTS})`,
    );
  }

  return { text: replyText, mathBuffers };
}
