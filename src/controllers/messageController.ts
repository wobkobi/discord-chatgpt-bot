/**
 * @file src/controllers/messageController.ts
 * @description Manages incoming Discord messages: applies rate-limits, tracks conversation threads,
 *   updates long-term memory, triggers AI reply generation, and persists chat state.
 *
 *   Utilises debounced interjection logic, thread summarisation, URL/file extraction,
 *   emoji shortcode substitution, and ensures seamless multi-turn dialogue handling.
 *   Each major step emits detailed debug logs for traceability.
 */

import { ConversationContext } from "@/types";
import { Client, Message } from "discord.js";
import OpenAI from "openai";
import { isBotReady } from "../index.js";
import { cloneUserId } from "../services/characterService.js";
import { generateReply } from "../services/replyService.js";
import { updateCloneMemory } from "../store/cloneMemory.js";
import { updateUserMemory } from "../store/userMemory.js";
import {
  createChatMessage,
  replaceEmojiShortcodes,
  summariseConversation,
} from "../utils/discordHelpers.js";
import { loadConversations, saveConversations } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";
import {
  getCooldownConfig,
  getCooldownContext,
  getInterjectionChance,
  isCooldownActive,
  manageCooldown,
} from "../utils/rateControl.js";
import { extractInputs } from "../utils/urlExtractor/index.js";

/**
 * Maximum number of messages a thread can hold before summarisation to memory.
 */
const MESSAGE_LIMIT = 10;

// In-memory storage for conversation histories and thread mappings
const histories = new Map<string, Map<string, ConversationContext>>();
const idMaps = new Map<string, Map<string, string>>();

// Flags for pending interjections per user/channel
const pendingInterjections = new Map<string, boolean>();
// Debounce timers to wait for user to finish typing
const interjectionTimers = new Map<string, NodeJS.Timeout>();

/**
 * Creates and returns the handler for new Discord messages.
 * @param openai - The OpenAI client instance for generating replies.
 * @param client - The Discord client instance.
 * @returns A function to handle 'messageCreate' events.
 */
export async function handleNewMessage(
  openai: OpenAI,
  client: Client
): Promise<(message: Message) => Promise<void>> {
  logger.debug("[messageController] Initialising message handler");
  return async (message: Message): Promise<void> => {
    logger.debug(
      `[messageController] Received message id=${message.id} from userId=${message.author.id}`
    );

    // Ignore bot messages, @everyone pings, or if bot not ready
    if (
      message.author.bot ||
      (message.guild && message.mentions.everyone) ||
      !isBotReady()
    ) {
      logger.debug("[messageController] Ignored message");
      return;
    }

    // Debounced interjection logic
    const key = `${message.channel.id}_${message.author.id}`;
    const mentioned = message.guild
      ? message.mentions.has(client.user!.id)
      : false;
    const guildId = message.guild?.id ?? null;
    const chance = getInterjectionChance(guildId);

    // Randomly queue an interjection if not directly mentioned
    if (!mentioned && Math.random() < chance) {
      pendingInterjections.set(key, true);
      logger.debug(`[messageController] Queued interjection for ${key}`);
    }

    // If queued, debounce for 2s to let user finish typing
    if (pendingInterjections.has(key)) {
      interjectionTimers.get(key)?.unref();
      clearTimeout(interjectionTimers.get(key)!);

      const timer = setTimeout(async () => {
        pendingInterjections.delete(key);
        interjectionTimers.delete(key);
        logger.debug(`[messageController] Firing interjection for ${key}`);
        await doReply(true);
      }, 2000);

      interjectionTimers.set(key, timer);
      return;
    }

    // If directly mentioned, reply immediately
    if (message.guild && mentioned) {
      try {
        await doReply(false);
      } catch (err) {
        logger.error("[messageController] Error in reply workflow:", err);
        await message.reply("⚠️ Sorry, I hit a snag generating that reply.");
      }
      return;
    }

    // Otherwise skip
    if (message.guild && !mentioned) {
      logger.debug("[messageController] No mention or interjection; skipping");
      return;
    }

    /**
     * Performs the reply workflow: cleans input, handles memory & cooldowns,
     * manages threading, summarises if needed, builds AI prompt, and sends reply.
     * @param interject - True if this is a spontaneous interjection.
     */
    async function doReply(interject: boolean) {
      // Strip out bot mention tags
      const cleanContent = message.content
        .replace(new RegExp(`<@!?${client.user!.id}>`, "g"), "")
        .trim();

      // Show typing indicator
      if (message.channel.isTextBased() && "sendTyping" in message.channel) {
        logger.debug("[messageController] Sending typing indicator");
        message.channel.sendTyping().catch(() => {});
      }

      // --- Memory & Cooldown ---
      const userId = message.author.id;
      const guildId = message.guild?.id || null;
      logger.debug(`[messageController] userId=${userId}, guildId=${guildId}`);

      // Update clone memory if this user is the clone
      if (userId === cloneUserId) {
        logger.debug("[messageController] Updating clone memory");
        updateCloneMemory(userId, {
          timestamp: Date.now(),
          content: cleanContent,
        });
      }

      // Enforce per-user/guild cooldown
      const { useCooldown, cooldownTime } = getCooldownConfig(guildId);
      const cdKey = getCooldownContext(guildId, userId);
      if (useCooldown && isCooldownActive(cdKey)) {
        const warn = await message.reply(
          `⏳ Cooldown: ${cooldownTime.toFixed(2)}s`
        );
        setTimeout(() => warn.delete().catch(() => {}), cooldownTime * 1000);
        return;
      }
      if (useCooldown) {
        manageCooldown(guildId, userId);
      }

      // --- Threading & History ---
      const contextKey = guildId || userId;
      if (!histories.has(contextKey)) {
        histories.set(contextKey, new Map());
        idMaps.set(contextKey, new Map());
        logger.debug(
          `[messageController] Initialized history for ${contextKey}`
        );
      }
      const convIds = idMaps.get(contextKey)!;
      const replyToId = message.reference?.messageId;
      const threadId =
        replyToId && convIds.has(replyToId)
          ? convIds.get(replyToId)!
          : `${message.channel.id}-${message.id}`;
      convIds.set(message.id, threadId);
      logger.debug(`[messageController] Thread ID=${threadId}`);

      const convMap = histories.get(contextKey)!;
      if (!convMap.has(threadId)) {
        convMap.set(threadId, { messages: new Map() });
        logger.debug("[messageController] Started new thread context");
      }
      const conversation = convMap.get(threadId)!;
      const userChat = createChatMessage(
        message,
        "user",
        client.user!.username
      );
      userChat.content = cleanContent;
      conversation.messages.set(message.id, userChat);
      logger.debug("[messageController] Stored user message in history");

      // --- Recent Channel History (500 chars max) ---
      let channelHistory: string | undefined;
      try {
        logger.debug("[messageController] Fetching recent channel history");
        const fetched = await message.channel.messages.fetch({ limit: 100 });
        const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
        let total = 0;
        const lines: string[] = [];
        for (const msg of Array.from(fetched.values()).sort(
          (a, b) => b.createdTimestamp - a.createdTimestamp
        )) {
          if (total >= 500) break;
          total += msg.content.length;
          const time = new Date(msg.createdTimestamp).toLocaleTimeString(
            systemLocale,
            { hour12: false, hour: "2-digit", minute: "2-digit" }
          );
          lines.push(`[${time}] ${msg.author.username}: ${msg.content}`);
        }
        channelHistory = lines.reverse().join("\n");
        logger.debug(
          `[messageController] Collected ${lines.length} history lines`
        );
      } catch (err) {
        logger.error(
          "[messageController] Failed to fetch channel history:",
          err
        );
      }

      // --- Input Extraction ---
      logger.debug("[messageController] Extracting inputs");
      const { blocks, genericUrls } = await extractInputs(message);
      logger.debug(
        `[messageController] Extracted ${blocks.length} blocks, ${genericUrls.length} URLs`
      );

      // --- Thread Summarisation ---
      if (conversation.messages.size >= MESSAGE_LIMIT) {
        logger.debug("[messageController] MESSAGE_LIMIT reached; summarising");
        const summary = summariseConversation(conversation);
        await updateUserMemory(userId, {
          timestamp: Date.now(),
          content: `🔖 ${summary}`,
        });
        logger.debug("[messageController] Saved summarisation to memory");
        conversation.messages.clear();
      }

      // --- Random Interjection Instruction ---
      if (interject) {
        blocks.unshift({
          type: "text" as const,
          text: "[System instruction] This is a random interjection: respond as a spontaneous comment, not as an answer to a question.",
        });
        logger.debug(
          "[messageController] Added interjection system instruction"
        );
      }

      // --- Generate & Send Reply ---
      logger.debug("[messageController] Generating AI reply");
      const { text, mathBuffers } = await generateReply(
        conversation.messages,
        message.id,
        openai,
        userId,
        channelHistory,
        blocks,
        genericUrls
      );
      logger.debug(
        `[messageController] AI reply ready (length=${text.length})`
      );

      const attachments = mathBuffers.map((buf, i) => ({
        attachment: buf,
        name: `math-${i}.png`,
      }));

      const output = message.guild
        ? replaceEmojiShortcodes(text, message.guild)
        : text;
      logger.debug("[messageController] Sending reply to channel");
      const sent = await message.reply({ content: output, files: attachments });
      logger.debug(`[messageController] Reply sent id=${sent.id}`);

      // --- Persist Assistant Message ---
      conversation.messages.set(
        sent.id,
        createChatMessage(sent, "assistant", client.user!.username)
      );
      logger.debug("[messageController] Recorded assistant message");
      await updateUserMemory(userId, {
        timestamp: Date.now(),
        content: `Replied: ${text}`,
      });
      logger.debug("[messageController] Updated user memory");
      await saveConversations(histories, idMaps);
      logger.debug("[messageController] Saved conversations to disk");
    }
  };
}

/**
 * Preloads stored conversations for each guild when the bot starts.
 * @param client - The Discord client instance.
 * @returns Promise<void> once loading completes.
 */
export async function run(client: Client): Promise<void> {
  logger.debug("[messageController] Preloading conversations for all guilds");
  const guildIds = Array.from(client.guilds.cache.keys());
  await Promise.all(
    guildIds.map((g) => loadConversations(g, histories, idMaps))
  );
  logger.info("✅ Preload complete");
}
