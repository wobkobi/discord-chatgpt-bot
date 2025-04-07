import { Client, Message } from "discord.js";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat";
import { defaultCooldownConfig } from "../config.js";
import {
  cloneUserId,
  getCharacterDescription,
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
import { ensureFileExists, markContextAsUpdated } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/** Remove stray @ symbols so Discord mentions work. */
function fixMentions(text: string): string {
  return text.replace(/@/g, "");
}

/** Wrap LaTeX‑style math ([…]) in inline code. */
function fixMathFormatting(text: string): string {
  return text.replace(/(\[[^\]]*\\[^\]]*\])/g, (m) => `\`${m}\``);
}

/** Only apply mention‑and‑math fixes; do not wrap entire text in code blocks. */
function applyDiscordMarkdownFormatting(text: string): string {
  return fixMathFormatting(fixMentions(text));
}

/** Build a ChatMessage from a Discord Message. */
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

/** Summarize the last three messages in the conversation context. */
function summarizeConversation(context: ConversationContext): string {
  return Array.from(context.messages.values())
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
}

/**
 * Generate a reply using OpenAI.
 * Optionally include a “Replying to:” note, channel history, and general (guild) memory.
 * When replying as the clone, it injects a separate "Clone memory:" note to capture its style.
 */
async function generateReply(
  messages: Map<string, ChatMessage>,
  currentMessageId: string,
  openai: OpenAI,
  userId: string,
  replyToInfo?: string,
  channelHistory?: string
): Promise<string> {
  // Build threaded context by traversing the reply chain.
  const thread: { role: "user" | "assistant" | "system"; content: string }[] =
    [];
  let id: string | undefined = currentMessageId;
  while (id) {
    const m = messages.get(id);
    if (!m) break;
    const sanitized = fixMentions(m.content);
    thread.unshift({
      role: m.role,
      content: m.role === "user" ? `${m.name} asked: ${sanitized}` : sanitized,
    });
    id = m.replyToId;
  }

  // Choose memory: if clone, use cloneMemory; otherwise use userMemory.
  const mem =
    userId === cloneUserId
      ? cloneMemory.get(userId) || []
      : userMemory.get(userId) || [];
  if (mem.length) {
    thread.unshift({
      role: "system",
      content:
        userId === cloneUserId
          ? "Clone memory:\n" + mem.map((e) => e.content).join("\n")
          : "Long-term memory:\n" + mem.map((e) => e.content).join("\n"),
    });
  }

  // Get the bot’s persona.
  const persona = (await getCharacterDescription(userId)).trim();
  const systemMsg: ChatCompletionMessageParam = {
    role: "system",
    content: persona,
  };

  // Optional reply note.
  const replyNote: ChatCompletionMessageParam | null = replyToInfo
    ? { role: "system", content: `Replying to: ${replyToInfo}` }
    : null;

  // Optional channel history note.
  const historyNote: ChatCompletionMessageParam | null = channelHistory
    ? { role: "system", content: `Recent channel history:\n${channelHistory}` }
    : null;

  // Assemble final prompt.
  const final: ChatCompletionMessageParam[] = [
    systemMsg,
    ...(replyNote ? [replyNote] : []),
    ...(historyNote ? [historyNote] : []),
    ...thread.map((t) => ({ role: t.role, content: t.content })),
  ];

  logger.info(`Prompt context:\n${JSON.stringify(final, null, 2)}`);

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: final,
      top_p: 0.6,
      frequency_penalty: 0.5,
      max_tokens: 2000,
    });
    const txt = res.choices[0]?.message.content;
    if (!txt) throw new Error("Empty response");
    return txt.trim();
  } catch (err: unknown) {
    logger.error("OpenAI error:", err);
    if (err instanceof APIError && err.code === "insufficient_quota") {
      return "Out of quota.";
    }
    throw err;
  }
}

const histories = new Map<string, Map<string, ConversationContext>>();
const idMaps = new Map<string, Map<string, string>>();
const MESSAGE_LIMIT = 10;

/**
 * Main message handler.
 * - Ignores bots and @everyone/@here.
 * - Tracks clone user without replying unless mentioned.
 * - Replies when explicitly mentioned or with a 1/50 interjection.
 * - Fetches the last 50 messages in the channel to build rich “Channel history.”
 * - Injects general (guild) memory (if available) into the prompt.
 */
export async function handleNewMessage(openai: OpenAI, client: Client) {
  return async (message: Message): Promise<void> => {
    if (message.author.bot) return;
    if (message.mentions.everyone) return;

    const userId = message.author.id;
    if (!histories.has(userId)) {
      histories.set(userId, new Map());
      idMaps.set(userId, new Map());
      markContextAsUpdated(userId);
    }

    const isMentioned = message.mentions.has(client.user!.id);
    if (message.author.id === cloneUserId && !isMentioned) {
      await updateCloneMemory(cloneUserId, {
        timestamp: Date.now(),
        content: message.content,
      });
      return;
    }

    // For guild messages, reply only if mentioned or if a 1/50 interjection occurs.
    const interject = message.guild && !isMentioned && Math.random() < 1 / 50;
    if (message.guild && !isMentioned && !interject) return;

    // Only send typing indicator if replying.
    if (message.channel.isTextBased() && "sendTyping" in message.channel) {
      message.channel.sendTyping().catch(() => {});
    }

    // Determine target message: if interjecting, use the last user message in this channel.
    let target: Message = message;
    if (interject) {
      const lastHist = histories.get(userId)!.get(message.channel.id)?.messages;
      const lastMsg = lastHist && Array.from(lastHist.values()).pop();
      if (lastMsg && lastMsg.id !== message.id) {
        target = lastMsg as unknown as Message;
      }
    }

    // Build conversation context.
    const map = idMaps.get(userId)!;
    const ctxId =
      target.reference?.messageId && map.has(target.reference.messageId)
        ? map.get(target.reference.messageId)!
        : `${target.channel.id}-${target.id}`;

    const userHist = histories.get(userId)!;
    let conv = userHist.get(ctxId);
    if (!conv) {
      conv = { messages: new Map() };
      userHist.set(ctxId, conv);
    }
    map.set(target.id, ctxId);

    // Add the target message.
    conv.messages.set(
      target.id,
      createChatMessage(target, "user", client.user!.username)
    );

    // Fetch the last 50 messages in the channel for context.
    let channelHistory: string | undefined = undefined;
    if (message.guild) {
      try {
        const fetched = await message.channel.messages.fetch({ limit: 50 });
        const sorted = Array.from(fetched.values()).sort(
          (a, b) => a.createdTimestamp - b.createdTimestamp
        );
        channelHistory = sorted
          .map((m) => {
            const t = new Date(m.createdTimestamp).toLocaleTimeString();
            return `${m.author.username} (${t}): ${m.content}`;
          })
          .join("\n");
      } catch (e) {
        logger.error("History fetch failed:", e);
      }
    }

    // Cooldown.
    const cdKey = getCooldownContext(message.guild?.id ?? null, userId);
    if (useCooldown && isCooldownActive(cdKey)) {
      const cd = defaultCooldownConfig.cooldownTime.toFixed(2);
      const warn = await message.reply(`Cooldown: ${cd}s`);
      setTimeout(() => warn.delete().catch(() => {}), 5000);
      return;
    }
    if (useCooldown) manageCooldown(message.guild?.id ?? null, userId);

    // Summarize conversation if message count is too high.
    if (conv.messages.size >= MESSAGE_LIMIT) {
      const sum = summarizeConversation(conv);
      await updateUserMemory(userId, {
        timestamp: Date.now(),
        content: `Summary: ${sum}`,
      });
      conv.messages.clear();
    }

    // Prepare reply information.
    const replyInfo = `${target.author.username} said: "${target.content}"`;

    // Generate and send reply.
    try {
      const txt = await generateReply(
        conv.messages,
        target.id,
        openai,
        userId,
        replyInfo,
        channelHistory
      );
      const out = applyDiscordMarkdownFormatting(txt);
      const sent = await message.reply(out);
      conv.messages.set(
        sent.id,
        createChatMessage(sent, "assistant", client.user!.username)
      );
      const newSum = summarizeConversation(conv);
      await updateUserMemory(userId, {
        timestamp: Date.now(),
        content: `Summary: ${newSum}`,
      });
      await ensureFileExists([userId], histories, idMaps);
    } catch (e) {
      logger.error("Reply error:", e);
      await message.reply("Error processing your request.");
    }
  };
}

/** On startup, load existing conversations from disk. */
export async function run(client: Client) {
  const guildIds = Array.from(client.guilds.cache.keys());
  await ensureFileExists(guildIds, histories, idMaps);
}
