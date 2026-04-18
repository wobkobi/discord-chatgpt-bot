/**
 * @file src/controllers/messageController.ts
 * @description Manages incoming Discord messages: applies rate-limits, tracks conversation threads,
 *   updates long-term memory, triggers AI reply generation, and persists chat state.
 */

import { isBotReady } from "@/index.js";
import { cloneUserId } from "@/services/characterService.js";
import { generateReply } from "@/services/replyService.js";
import { updateCloneMemory } from "@/store/cloneMemory.js";
import { updateUserMemory } from "@/store/userMemory.js";
import { ConversationContext } from "@/types/chat.js";
import {
  createChatMessage,
  replaceEmojiShortcodes,
  summariseConversation,
} from "@/utils/discordHelpers.js";
import { loadConversations, saveConversations } from "@/utils/fileUtils.js";
import logger from "@/utils/logger.js";
import {
  getCooldownConfig,
  getCooldownContext,
  getInterjectionChance,
  isCooldownActive,
  manageCooldown,
} from "@/utils/rateControl.js";
import { extractInputs } from "@/utils/urlExtractor/index.js";
import { Client, Message } from "discord.js";
import OpenAI from "openai";

/** Maximum number of messages a thread can hold before summarisation to memory. */
const MESSAGE_LIMIT = 10;

const histories = new Map<string, Map<string, ConversationContext>>();
const idMaps = new Map<string, Map<string, string>>();

const LOCALE = Intl.DateTimeFormat().resolvedOptions().locale;

let saveTimer: NodeJS.Timeout | undefined;
/**
 * Debounces conversation persistence, writing to disk 5 seconds after the last reply.
 */
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    saveConversations(histories, idMaps).catch((err) =>
      logger.error("[messageController] Failed to save conversations:", err),
    );
  }, 5000);
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
    updateCloneMemory(userId, { timestamp: Date.now(), content: cleanContent });
  }

  const { useCooldown, cooldownTime } = getCooldownConfig(guildId);
  const cdKey = getCooldownContext(guildId, userId);
  if (useCooldown && isCooldownActive(cdKey)) {
    const warn = await message.reply(`⏳ Cooldown: ${cooldownTime.toFixed(2)}s`);
    setTimeout(() => warn.delete().catch(() => {}), cooldownTime * 1000);
    return;
  }
  if (useCooldown) manageCooldown(guildId, userId);

  const contextKey = guildId ?? userId;
  if (!histories.has(contextKey)) {
    histories.set(contextKey, new Map());
    idMaps.set(contextKey, new Map());
  }

  const convIds = idMaps.get(contextKey)!;
  const replyToId = message.reference?.messageId;
  const threadId =
    replyToId && convIds.has(replyToId)
      ? convIds.get(replyToId)!
      : `${message.channel.id}-${message.id}`;
  convIds.set(message.id, threadId);

  const convMap = histories.get(contextKey)!;
  if (!convMap.has(threadId)) convMap.set(threadId, { messages: new Map() });
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
    conversation.messages.clear();
  }

  if (interject) {
    blocks.unshift({
      type: "text" as const,
      text: "[System instruction] This is a random interjection: respond as a spontaneous comment, not as an answer to a question.",
    });
  }

  const { text, mathBuffers } = await generateReply(
    conversation.messages,
    message.id,
    openai,
    userId,
    channelHistory,
    blocks,
    genericUrls,
  );

  const attachments = mathBuffers.map((buf, i) => ({ attachment: buf, name: `math-${i}.png` }));
  const output = message.guild ? replaceEmojiShortcodes(text, message.guild) : text;
  const sent = await message.reply({ content: output, files: attachments });

  conversation.messages.set(sent.id, createChatMessage(sent, "assistant", client.user!.username));
  await updateUserMemory(userId, { timestamp: Date.now(), content: `Replied: ${text}` });
  scheduleSave();
}

/**
 * Creates and returns the `messageCreate` event handler.
 * @param openai - The OpenAI client instance.
 * @param client - The Discord client instance.
 * @returns A function to handle `messageCreate` events.
 */
export async function handleNewMessage(
  openai: OpenAI,
  client: Client,
): Promise<(message: Message) => Promise<void>> {
  return async (message: Message): Promise<void> => {
    const chanId = message.channel.id;
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
      interjectionTimers.get(key)?.unref();
      clearTimeout(interjectionTimers.get(key)!);
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
  await Promise.all(guildIds.map((g) => loadConversations(g, histories, idMaps)));
  logger.info("✅ Preload complete");
}
