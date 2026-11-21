// src/controllers/messageController.ts
// Manages incoming Discord messages: applies rate limits, tracks conversation threads,
// updates long-term memory, triggers AI reply generation, and persists chat state.

import { cloneUserId } from "@/services/characterService";
import { generateReply } from "@/services/replyService";
import { updateCloneMemory } from "@/store/cloneMemory";
import { updateUserMemory } from "@/store/userMemory";
import { ConversationContext } from "@/types/chat";
import { isBotReady } from "@/utils/botState";
import {
  createChatMessage,
  replaceEmojiShortcodes,
  summariseConversation,
} from "@/utils/discordHelpers";
import { loadConversations, saveConversations } from "@/utils/fileUtils";
import logger from "@/utils/logger";
import {
  getCooldownConfig,
  getCooldownContext,
  getInterjectionChance,
  isCooldownActive,
  manageCooldown,
} from "@/utils/rateControl";
import { extractInputs } from "@/utils/urlExtractor/index";
import { Client, Message } from "discord.js";
import OpenAI from "openai";

/** Maximum number of messages a thread can hold before summarisation to memory. */
const MESSAGE_LIMIT = 10;

/** Maximum threads kept in memory per context before the oldest are dropped. */
const THREAD_LIMIT = 100;

const histories = new Map<string, Map<string, ConversationContext>>();
const idMaps = new Map<string, Map<string, string>>();

/** In-flight loads per context key, so two quick messages share one disk read. */
const pendingLoads = new Map<string, Promise<void>>();

/**
 * Drop the oldest threads (Map insertion order) and their message-ID mappings once a
 * context exceeds {@link THREAD_LIMIT}, keeping long-running instances memory-bounded.
 * Dropped thread IDs are collected first so the ID map is swept once, not once per thread,
 * which matters when a large saved file is trimmed on load.
 * @param convMap - Thread map for one context.
 * @param convIds - Message-ID to thread-ID map for the same context.
 */
function pruneThreads(
  convMap: Map<string, ConversationContext>,
  convIds: Map<string, string>,
): void {
  if (convMap.size <= THREAD_LIMIT) return;
  const dropped = new Set<string>();
  for (const threadId of convMap.keys()) {
    if (convMap.size <= THREAD_LIMIT) break;
    convMap.delete(threadId);
    dropped.add(threadId);
  }
  for (const [msgId, threadId] of convIds) {
    if (dropped.has(threadId)) convIds.delete(msgId);
  }
}

/**
 * Make sure a context's saved threads are in memory before it is used. Without this, a
 * context that was not preloaded (any DM) would start empty and the next save would
 * overwrite its file. Concurrent callers for the same key await the same load.
 * @param contextKey - Guild ID, or user ID for a DM.
 * @returns Promise that resolves once the context is present in memory.
 */
async function ensureContextLoaded(contextKey: string): Promise<void> {
  if (histories.has(contextKey)) return;
  let pending = pendingLoads.get(contextKey);
  if (!pending) {
    pending = loadConversations(contextKey, histories, idMaps)
      .then(() => pruneThreads(histories.get(contextKey)!, idMaps.get(contextKey)!))
      .finally(() => pendingLoads.delete(contextKey));
    pendingLoads.set(contextKey, pending);
  }
  await pending;
}

const LOCALE = Intl.DateTimeFormat().resolvedOptions().locale;

let saveTimer: NodeJS.Timeout | undefined;
/**
 * Debounces conversation persistence, writing to disk 5 seconds after the last reply.
 */
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    saveConversations(histories).catch((err) =>
      logger.error("[messageController] Failed to save conversations:", err),
    );
  }, 5000);
}

/**
 * Cancel any pending debounced save and write all conversations now. Called on shutdown
 * so the last few seconds of replies are not lost to the debounce window.
 * @returns Promise that resolves once every context has been written.
 */
export async function flushConversations(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  await saveConversations(histories);
}

const pendingInterjections = new Map<string, boolean>();
const interjectionTimers = new Map<string, NodeJS.Timeout>();

/** Tracks how many non-bot messages have occurred since the last bot message in each channel. */
const messagesSinceBot = new Map<string, number>();

/**
 * Performs the full reply workflow for a single incoming message.
 * @param message - The Discord message to reply to.
 * @param client - The Discord client instance.
 * @param openai - The OpenAI client instance.
 * @param interject - True if this is a spontaneous interjection rather than a direct reply.
 */
async function doReply(
  message: Message,
  client: Client,
  openai: OpenAI,
  interject: boolean,
): Promise<void> {
  const cleanContent = message.content
    .replace(new RegExp(`<@!?${client.user!.id}>`, "g"), "")
    .trim();

  if (message.channel.isTextBased() && "sendTyping" in message.channel) {
    message.channel.sendTyping().catch(() => {});
  }

  const userId = message.author.id;
  const guildId = message.guild?.id ?? null;

  if (userId === cloneUserId) {
    await updateCloneMemory(userId, { timestamp: Date.now(), content: cleanContent });
  }

  const { useCooldown, cooldownTime } = getCooldownConfig(guildId);
  const cdKey = getCooldownContext(guildId, userId);
  if (useCooldown && isCooldownActive(cdKey)) {
    // An interjection was never asked for, so a cooldown warning would be noise
    if (interject) return;
    const warn = await message.reply(`⏳ Cooldown: ${cooldownTime.toFixed(2)}s`);
    setTimeout(() => warn.delete().catch(() => {}), cooldownTime * 1000);
    return;
  }
  if (useCooldown) manageCooldown(guildId, userId);

  const contextKey = guildId ?? userId;
  await ensureContextLoaded(contextKey);

  const convIds = idMaps.get(contextKey)!;
  const replyToId = message.reference?.messageId;
  const threadId =
    replyToId && convIds.has(replyToId)
      ? convIds.get(replyToId)!
      : `${message.channel.id}-${message.id}`;
  convIds.set(message.id, threadId);

  const convMap = histories.get(contextKey)!;
  if (!convMap.has(threadId)) {
    convMap.set(threadId, { messages: new Map() });
    pruneThreads(convMap, convIds);
  }
  const conversation = convMap.get(threadId)!;

  const userChat = createChatMessage(message, "user", client.user!.username);
  userChat.content = cleanContent;
  conversation.messages.set(message.id, userChat);

  // Channel history is only used by replyService on new threads; skip the fetch otherwise
  let channelHistory: string | undefined;
  if (conversation.messages.size <= 1) {
    try {
      const fetched = await message.channel.messages.fetch({ limit: 100 });
      let total = 0;
      const lines: string[] = [];
      for (const msg of Array.from(fetched.values()).sort(
        (a, b) => b.createdTimestamp - a.createdTimestamp,
      )) {
        if (total >= 500) break;
        total += msg.content.length;
        const time = new Date(msg.createdTimestamp).toLocaleTimeString(LOCALE, {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        });
        lines.push(`[${time}] ${msg.author.username}: ${msg.content}`);
      }
      channelHistory = lines.reverse().join("\n");
    } catch (err) {
      logger.error("[messageController] Failed to fetch channel history:", err);
    }
  }

  const { blocks, genericUrls } = await extractInputs(message);

  if (conversation.messages.size >= MESSAGE_LIMIT) {
    const summary = summariseConversation(conversation);
    await updateUserMemory(userId, { timestamp: Date.now(), content: `🔖 ${summary}` });
    // Reset the thread but keep the message being answered - clearing it too would
    // hand generateReply an empty prompt. Old ID mappings die with the history.
    conversation.messages.clear();
    conversation.messages.set(message.id, userChat);
    for (const [msgId, tid] of convIds) {
      if (tid === threadId && msgId !== message.id) convIds.delete(msgId);
    }
  }

  if (interject) {
    blocks.unshift({
      type: "text" as const,
      text: "[System instruction] This is a random interjection: respond as a spontaneous comment, not as an answer to a question.",
    });
  }

  // Read straight off the cache so a rename or a newly uploaded emote is reflected on the
  // next reply rather than at the next restart.
  const emoteNames = message.guild
    ? message.guild.emojis.cache.map((e) => e.name).filter((n): n is string => n !== null)
    : [];

  const { text, mathBuffers } = await generateReply(
    conversation.messages,
    message.id,
    openai,
    userId,
    channelHistory,
    blocks,
    genericUrls,
    emoteNames,
  );

  const attachments = mathBuffers.map((buf, i) => ({ attachment: buf, name: `math-${i}.png` }));
  const resolved = message.guild ? replaceEmojiShortcodes(text, message.guild) : text;
  // A reply that was nothing but unresolvable emotes resolves to an empty string, which the
  // Discord API rejects; send the unresolved text rather than throwing away the whole reply.
  const output = resolved || text;
  const sent = await message.reply({ content: output, files: attachments });

  conversation.messages.set(sent.id, createChatMessage(sent, "assistant", client.user!.username));
  // Record both halves of the exchange: storing only the reply leaves long-term memory
  // with no record of anything the user actually said. Name-prefixed so the model can
  // attribute facts to the right person in a shared channel.
  const now = Date.now();
  if (cleanContent) {
    await updateUserMemory(userId, {
      timestamp: now,
      content: `${message.author.username} said: ${cleanContent}`,
    });
  }
  // Store what was actually sent, not the raw completion: an emote the guild does not have is
  // dropped on the way out, and recording the shortcode anyway would feed the invented name
  // back through long-term memory and teach the model to keep using it.
  await updateUserMemory(userId, { timestamp: now, content: `Replied: ${output}` });
  scheduleSave();
}

/**
 * Creates and returns the `messageCreate` event handler.
 * @param openai - The OpenAI client instance.
 * @param client - The Discord client instance.
 * @returns A function to handle `messageCreate` events.
 */
export function handleNewMessage(
  openai: OpenAI,
  client: Client,
): (message: Message) => Promise<void> {
  return async (message: Message): Promise<void> => {
    const chanId = message.channel.id;
    // Bot messages (this bot's own replies included) reset the interjection counter, then
    // stop here before any reply logic.
    if (message.author.bot) {
      messagesSinceBot.set(chanId, 0);
    } else {
      messagesSinceBot.set(chanId, (messagesSinceBot.get(chanId) ?? 0) + 1);
    }

    if (message.author.bot || (message.guild && message.mentions.everyone) || !isBotReady()) {
      return;
    }

    const key = `${chanId}_${message.author.id}`;
    const mentioned = message.guild ? message.mentions.has(client.user!.id) : false;
    const guildId = message.guild?.id ?? null;
    const chance = getInterjectionChance(guildId);
    const userCount = messagesSinceBot.get(chanId) ?? 0;

    if (message.guild && !mentioned && userCount >= 5 && Math.random() < chance) {
      pendingInterjections.set(key, true);
    }

    if (pendingInterjections.has(key)) {
      clearTimeout(interjectionTimers.get(key));
      const timer = setTimeout(async () => {
        pendingInterjections.delete(key);
        interjectionTimers.delete(key);
        try {
          await doReply(message, client, openai, true);
        } catch (err) {
          logger.error("[messageController] Error in interjection reply:", err);
        }
      }, 2000);
      interjectionTimers.set(key, timer);
      return;
    }

    if (message.guild && mentioned) {
      try {
        await doReply(message, client, openai, false);
      } catch (err) {
        logger.error("[messageController] Error in reply workflow:", err);
        await message.reply("⚠️ Sorry, I hit a snag generating that reply.");
      }
      return;
    }

    if (message.guild && !mentioned) return;

    // DM: always reply
    try {
      await doReply(message, client, openai, false);
    } catch (err) {
      logger.error("[messageController] Error in DM reply workflow:", err);
      await message.reply("⚠️ Sorry, I hit a snag generating that reply.");
    }
  };
}

/**
 * Preloads saved conversation threads for all guilds the bot is in.
 * @param client - The Discord client instance.
 * @returns Promise that resolves once all guild conversations are loaded.
 */
export async function run(client: Client): Promise<void> {
  const guildIds = Array.from(client.guilds.cache.keys());
  await Promise.all(guildIds.map((g) => ensureContextLoaded(g)));
  logger.info("✅ Preload complete");
}
