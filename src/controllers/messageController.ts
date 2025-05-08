/**
 * @file src/controllers/messageController.ts
 * @description Handles inbound Discord messages: applies cooldowns, manages conversation threads,
 *   updates memory, invokes AI reply generation, and persists conversation state.
 * @remarks
 *   Implements mention and interjection logic, summarisation, URL/file extraction, emoji replacement,
 *   and ensures smooth multi-turn dialogue management.
 */

import { Block, ConversationContext } from "@/types";
import { Client, Message } from "discord.js";
import OpenAI from "openai";
import { isBotReady } from "../index.js";
import { cloneUserId } from "../services/characterService.js";
import { generateReply } from "../services/replyService.js";
import { updateCloneMemory } from "../store/cloneMemory.js";
import { updateUserMemory } from "../store/userMemory.js";
import {
  getCooldownConfig,
  getCooldownContext,
  isCooldownActive,
  manageCooldown,
  useCooldown,
} from "../utils/cooldown.js";
import {
  createChatMessage,
  replaceEmojiShortcodes,
  summariseConversation,
} from "../utils/discordHelpers.js";
import { loadConversations, saveConversations } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";
import { extractInputs } from "../utils/urlExtractor/index.js";

/**
 * Maximum number of messages in a thread before triggering summarisation.
 */
const MESSAGE_LIMIT = 10;

// In-memory maps storing conversation histories and thread ID mappings per context
const histories = new Map<string, Map<string, ConversationContext>>();
const idMaps = new Map<string, Map<string, string>>();
const pendingInterjections = new Map<string, boolean>();

/**
 * Creates a handler for processing new Discord messages.
 * Applies ignore rules, cooldowns, memory updates, threading, summarisation,
 * input extraction, AI invocation, and persistence.
 *
 * @param openai - The OpenAI client instance used for generating replies.
 * @param client - The Discord client instance.
 * @returns Handler function for 'messageCreate' events.
 */
export async function handleNewMessage(
  openai: OpenAI,
  client: Client
): Promise<(message: Message) => Promise<void>> {
  logger.debug("[messageController] Initialising new message handler");
  return async (message: Message): Promise<void> => {
    logger.debug(
      `[messageController] Received message id=${message.id} from userId=${message.author.id}`
    );

    // Ignore bot messages, mass mentions, or if bot not initialised
    if (message.author.bot) {
      logger.debug("[messageController] Ignoring bot message");
      return;
    }
    if (message.guild && message.mentions.everyone) {
      logger.debug("[messageController] Ignoring @everyone mention");
      return;
    }
    if (!isBotReady()) {
      logger.debug("[messageController] Bot not ready yet");
      return;
    }

    // Mention and random interjection logic
    const mentioned = message.guild
      ? message.mentions.has(client.user!.id)

      : false;
    const key = `${message.channel.id}_${message.author.id}`;

    let interject = false;
    if (pendingInterjections.has(key)) {
      interject = true;
      pendingInterjections.delete(key);
    }
    if (!interject && message.guild && !mentioned) {
      const fetched = await message.channel.messages.fetch({ limit: 6 });
      const lastFive = Array.from(fetched.values())
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .slice(1, 6);
      const botInLastFive = lastFive.some((m) => m.author.bot);
      if (!botInLastFive && Math.random() < 1 / 50) interject = true;
      logger.debug(`[messageController] Interject=${interject}`);
    }
    if (
      message.guild &&
      interject &&
      !pendingInterjections.has(key) &&
      !pendingInterjections.delete(key)
    ) {
      pendingInterjections.set(key, true);
      logger.debug(
        `[messageController] Queued interjection for next message in ${key}`
      );
      return;
    }
    if (message.guild && !mentioned && !interject) {
      pendingInterjections.set(key, true);
      logger.debug("[messageController] No mention or interjection; skipping");
      return;
    }

    // Show typing indicator
    if (message.channel.isTextBased() && "sendTyping" in message.channel) {
      logger.debug("[messageController] Sending typing indicator");
      message.channel.sendTyping().catch(() => {});
    }

    // Memory & cooldowns
    const userId = message.author.id;
    const guildId = message.guild?.id || null;
    logger.debug(`[messageController] userId=${userId}, guildId=${guildId}`);

    if (userId === cloneUserId) {
      logger.debug("[messageController] Updating clone memory");
      updateCloneMemory(userId, {
        timestamp: Date.now(),
        content: message.content,
      });
    }

    const cdKey = getCooldownContext(guildId, userId);
    if (useCooldown && isCooldownActive(cdKey)) {
      const { cooldownTime } = getCooldownConfig(guildId);
      logger.debug("[messageController] Cooldown active; notifying user");
      const warn = await message.reply(
        `⏳ Cooldown: ${cooldownTime.toFixed(2)}s`
      );
      setTimeout(() => warn.delete().catch(() => {}), cooldownTime * 1000);
      return;
    }
    if (useCooldown) {
      logger.debug("[messageController] Managing cooldown");
      manageCooldown(guildId, userId);
    }

    // Threading & history
    const contextKey = guildId || userId;
    if (!histories.has(contextKey)) {
      histories.set(contextKey, new Map());
      idMaps.set(contextKey, new Map());
      logger.debug(
        `[messageController] Initialized history for context=${contextKey}`
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
      logger.debug("[messageController] Started new conversation context");
    }
    const conversation = convMap.get(threadId)!;
    conversation.messages.set(
      message.id,
      createChatMessage(message, "user", client.user?.username)
    );

    // Fetch recent channel history
    let channelHistory: string | undefined;
if (message.guild) {
  try {
    logger.debug("[messageController] Fetching recent channel history");
    const fetched = await message.channel.messages.fetch({ limit: 100 });
    const sorted = Array.from(fetched.values()).sort(
      (a, b) => b.createdTimestamp - a.createdTimestamp
    );

    // Get the system locale once
    const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;

    let total = 0;
    const lines: string[] = [];
    for (const msg of sorted) {
      const text = msg.content;
      if (total >= 500) break;
      total += text.length;

      // Format time using system locale
      const time = new Date(msg.createdTimestamp).toLocaleTimeString(
        systemLocale,
        {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        }
      );

      lines.push(`[${time}] ${msg.author.username}: ${text}`);
    }

    // Reverse to get oldest → newest
    channelHistory = lines.reverse().join("\n");
  } catch (err) {
    logger.error("[messageController] Failed to fetch channel history:", err);
  }
}

    // Input extraction
    logger.debug("[messageController] Extracting inputs");
    const { blocks, genericUrls } = await extractInputs(message);
    logger.debug(
      `[messageController] Extracted ${blocks.length} blocks and ${genericUrls.length} URLs`
    );

    // Summarise if too long
    if (conversation.messages.size >= MESSAGE_LIMIT) {
      logger.debug("[messageController] MESSAGE_LIMIT reached; summarising");
      const summary = summariseConversation(conversation);
      await updateUserMemory(userId, {
        timestamp: Date.now(),
        content: `🔖 ${summary}`,
      });
      conversation.messages.clear();
    }

    // Prepare reply info
    let replyToInfo = `${message.author.username} said: "${message.content}"`;
    if (interject) {
      replyToInfo = `🔀 Random interjection — ${replyToInfo}`;
      blocks.unshift({
        type: "text",
        text: "[System instruction] This is a random interjection: respond as a spontaneous comment, not as an answer to a question.",
      } as Block);
      logger.debug("[messageController] Added interjection system instruction");
    }

    // Generate and send reply
    logger.debug("[messageController] Generating AI reply");
    const { text, mathBuffers } = await generateReply(
      conversation.messages,
      message.id,
      openai,
      userId,
      replyToInfo,
      channelHistory,
      blocks,
      genericUrls
    );
    logger.debug(
      `[messageController] AI reply generated text length=${text.length}, maths buffers=${mathBuffers.length}`
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

    // Record and persist
    conversation.messages.set(
      sent.id,
      createChatMessage(sent, "assistant", client.user?.username)
    );
    logger.debug("[messageController] Recording assistant message");
    await updateUserMemory(userId, {
      timestamp: Date.now(),
      content: `Replied: ${text}`,
    });
    logger.debug("[messageController] Updated user memory");
    await saveConversations(histories, idMaps);
    logger.debug("[messageController] Saved conversations to disk");
  };
}

/**
 * Preloads stored conversations for each guild when the bot starts.
 *
 * @param client - The Discord client instance.
 * @returns Promise<void> that resolves once loading completes.
 */
export async function run(client: Client): Promise<void> {
  logger.debug("[messageController] Preloading conversations for all guilds");
  const guildIds = Array.from(client.guilds.cache.keys());
  await Promise.all(
    guildIds.map((g) => loadConversations(g, histories, idMaps))
  );
  logger.info("✅ Preload complete");
}
