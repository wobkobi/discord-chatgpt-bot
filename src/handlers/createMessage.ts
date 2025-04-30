import { Client, Guild, Message } from "discord.js";
import "dotenv/config";
import OpenAI, { APIError } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";
import { defaultCooldownConfig } from "../config.js";
import {
  cloneUserId,
  fixMathFormatting,
  getCharacterDescription,
  markdownGuide,
} from "../data/characterDescription.js";
import { cloneMemory, updateCloneMemory } from "../memory/cloneMemory.js";
import { updateUserMemory, userMemory } from "../memory/userMemory.js";
import { ChatMessage, ConversationContext } from "../types/types.js";
import {
  getCooldownContext,
  isCooldownActive,
  manageCooldown,
  useCooldown,
} from "../utils/cooldown.js";
import {
  ensureFileExists,
  markContextAsUpdated,
  saveConversations,
} from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

// --- Helpers ---------------------------------------------------------

/** Normalize mentions so raw IDs become `<@123…>` and remove stray `@`. */
function fixMentions(text: string): string {
  return text
    .replace(/<@!?(\d+)>/g, "<@$1>")
    .replace(/<(\d+)>/g, "<@$1>")
    .replace(/@/g, "");
}

/** Apply all of our Discord‐safe formatting tweaks. */
function applyDiscordMarkdownFormatting(text: string): string {
  return fixMathFormatting(fixMentions(text));
}

/** Replace `:emoji_name:` with the actual guild emoji if present. */
function replaceEmojiShortcodes(text: string, guild: Guild): string {
  return text.replace(/:([a-zA-Z0-9_]+):/g, (_, name) => {
    const e = guild.emojis.cache.find((e) => e.name === name);
    return e ? `<:${e.name}:${e.id}>` : `:${name}:`;
  });
}

/** Convert a Discord `Message` into our `ChatMessage` shape. */
function createChatMessage(
  message: Message,
  role: "user" | "assistant",
  botName?: string
): ChatMessage {
  const name =
    role === "user"
      ? message.author.username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
      : (botName ?? "Bot");
  return {
    id: message.id,
    role,
    name,
    userId: role === "user" ? message.author.id : undefined,
    content: message.content,
    replyToId: message.reference?.messageId,
  };
}

/** Take the last three messages and smash them into a one‐line summary. */
function summarizeConversation(context: ConversationContext): string {
  return Array.from(context.messages.values())
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
}

// --- Multimodal Reply Generation -------------------------------------

/**
 * Build and send a single ChatCompletion that may include images
 * @param convoHistory  all prior turns in this thread (user+assistant)
 * @param currentId     the ID of the most recent user message
 * @param openai        OpenAI client
 * @param userId        Discord user ID
 * @param replyToInfo   optional “Replying to: …” note
 * @param channelHistory optional text dump of recent channel
 * @param imageUrls     optional list of image URLs to send as vision inputs
 */
export async function generateReply(
  convoHistory: Map<string, ChatMessage>,
  currentId: string,
  openai: OpenAI,
  userId: string,
  replyToInfo?: string,
  channelHistory?: string,
  imageUrls: string[] = []
): Promise<string> {
  // Decide which model to use (plain GPT or your fine-tuned FT)
  const useFT = process.env.USE_FINE_TUNED_MODEL === "true";
  const modelName = useFT
    ? process.env.FINE_TUNED_MODEL_NAME ||
      (logger.error("FINE_TUNED_MODEL_NAME missing, exiting."),
      process.exit(1),
      "")
    : "gpt-4o";

  // Build our “system” messages
  const messages: ChatCompletionMessageParam[] = [];
  if (process.env.USE_PERSONA === "true") {
    // 1) inject persona
    const persona = await getCharacterDescription(userId);
    messages.push({ role: "system", content: persona });
    // 2) inject long‐term memory
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
  // optional metadata
  if (replyToInfo) {
    messages.push({ role: "system", content: `Replying to: ${replyToInfo}` });
  }
  if (channelHistory) {
    messages.push({
      role: "system",
      content: `Recent channel history:\n${channelHistory}`,
    });
  }

  messages.push({ role: "system", content: markdownGuide });

  const userBlocks: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];
  // Walk back from the current message through `.replyToId`
  let cursor: string | undefined = currentId;
  while (cursor) {
    const turn = convoHistory.get(cursor);
    if (!turn) break;
    const clean = fixMathFormatting(fixMentions(turn.content));
    if (turn.role === "user") {
      userBlocks.unshift({
        type: "text",
        text: `${turn.name} asked: ${clean}`,
      });
    } else {
      userBlocks.unshift({ type: "text", text: clean });
    }
    cursor = turn.replyToId;
  }

  // If the user attached images, append them as vision blocks:
  for (const url of imageUrls) {
    userBlocks.push({ type: "image_url", image_url: { url } });
  }

  // Finally, emit a single “user” message whose content is either:
  // - an array of blocks (if images present or always, your choice)
  // - or join all the text blocks into one big string if you prefer the old style
  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content:
      userBlocks.length > 0
        ? userBlocks
        : // fallback: empty question?
          [{ type: "text", text: "" }],
  };

  messages.push(userMessage);

  logger.info(
    `📝 Prompt → model=${modelName}, blocks=${userBlocks.length}\n` +
      `Prompt context:\n${JSON.stringify(messages, null, 2)}`
  );

  try {
    const res = await openai.chat.completions.create({
      model: modelName,
      messages,
      top_p: 0.6,
      frequency_penalty: 0.5,
      max_tokens: 2_000,
    });
    const out = res.choices[0]?.message.content;
    if (!out) throw new Error("Empty AI response");
    return out.trim();
  } catch (err: unknown) {
    // If you tried to use a bad FT, exit cleanly
    if (useFT && err instanceof APIError && err.code === "model_not_found") {
      logger.error(`Fine-tuned model not found: ${modelName}`);
      process.exit(1);
    }
    logger.error("OpenAI error:", err);
    if (err instanceof APIError && err.code === "insufficient_quota") {
      return "⚠️ Out of quota.";
    }
    throw err;
  }
}

// --- Conversation Management & Redispatch ----------------------------

const histories = new Map<string, Map<string, ConversationContext>>();
const idMaps = new Map<string, Map<string, string>>();
const MESSAGE_LIMIT = 10;

/**
 * Returns a message‐handler that you can wire to `client.on("messageCreate",…)`
 */
export async function handleNewMessage(
  openai: OpenAI,
  client: Client
): Promise<(message: Message) => Promise<void>> {
  return async (message: Message): Promise<void> => {
    // ignore bots & @everyone
    if (message.author.bot) return;
    if (message.guild && message.mentions.everyone) return;

    // must be a DM or mention or 1/50 interjection in a guild
    const mentioned = message.guild
      ? message.mentions.has(client.user!.id)
      : true;
    const interject = message.guild && !mentioned && Math.random() < 1 / 50;
    if (message.guild && !mentioned && !interject) return;

    // typing indicator
    if (message.channel.isTextBased() && "sendTyping" in message.channel) {
      message.channel.sendTyping().catch(() => {});
    }

    const userId = message.author.id;
    const guildId = message.guild?.id ?? null;

    // update clone memory
    if (userId === cloneUserId) {
      await updateCloneMemory(cloneUserId, {
        timestamp: Date.now(),
        content: message.content,
      });
    }

    // enforce cooldown
    const cdKey = getCooldownContext(guildId, userId);
    if (useCooldown && isCooldownActive(cdKey)) {
      const cd = defaultCooldownConfig.cooldownTime.toFixed(2);
      const warn = await message.reply(`⏳ Cooldown: ${cd}s`);
      setTimeout(() => warn.delete().catch(() => {}), 5_000);
      return;
    }
    if (useCooldown) manageCooldown(guildId, userId);

    // init per‐context stores
    const contextKey = message.guild ? guildId! : userId;
    if (!histories.has(contextKey)) {
      histories.set(contextKey, new Map());
      idMaps.set(contextKey, new Map());
    }
    markContextAsUpdated(contextKey);
    const convIds = idMaps.get(contextKey)!;

    // pick / assign this turn’s conversation ID
    const replyToId = message.reference?.messageId;
    const ctxId =
      replyToId && convIds.has(replyToId)
        ? convIds.get(replyToId)!
        : `${message.channel.id}-${message.id}`;
    convIds.set(message.id, ctxId);

    // grab or create that conversation
    const convMap = histories.get(contextKey)!;
    if (!convMap.has(ctxId)) {
      convMap.set(ctxId, { messages: new Map() });
    }
    const conversation = convMap.get(ctxId)!;

    // record the user’s turn
    conversation.messages.set(
      message.id,
      createChatMessage(message, "user", client.user?.username)
    );

    // fetch a little channel history if we’re in a guild
    let channelHistory: string | undefined;
    if (message.guild) {
      try {
        const fetched = await message.channel.messages.fetch({ limit: 50 });
        channelHistory = Array.from(fetched.values())
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map((m) => `${m.author.username}: ${m.content}`)
          .join("\n");
      } catch (err) {
        logger.error("Failed to fetch channel history:", err);
      }
    }

    // gather any image attachments
    const imageUrls = Array.from(message.attachments.values())
      .filter((a) => a.contentType?.startsWith("image/"))
      .map((a) => a.url);

    // if the convo is getting long, summarize + archive
    if (conversation.messages.size >= MESSAGE_LIMIT) {
      const summary = summarizeConversation(conversation);
      await updateUserMemory(userId, {
        timestamp: Date.now(),
        content: `🔖 ${summary}`,
      });
      conversation.messages.clear();
    }

    // dispatch to OpenAI
    const replyInfo = `${message.author.username} said: "${message.content}"`;
    const aiResponse = await generateReply(
      conversation.messages,
      message.id,
      openai,
      userId,
      replyInfo,
      channelHistory,
      imageUrls
    );

    // patch up markdown + emojis and send back
    let out = applyDiscordMarkdownFormatting(aiResponse);
    if (message.guild) out = replaceEmojiShortcodes(out, message.guild);

    const sent = await message.reply(out);
    // record the assistant’s turn
    conversation.messages.set(
      sent.id,
      createChatMessage(sent, "assistant", client.user?.username)
    );
    // persist memory & conversations to disk
    await updateUserMemory(userId, {
      timestamp: Date.now(),
      content: `Replied: ${out}`,
    });
    await saveConversations(histories, idMaps);
  };
}

/** On bot startup, preload any existing conversation files */
export async function run(client: Client): Promise<void> {
  const guildIds = Array.from(client.guilds.cache.keys());
  await ensureFileExists(guildIds, histories, idMaps);
}
