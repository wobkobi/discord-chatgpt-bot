/**
 * @file src/controllers/messageController.ts
 * @description Handles incoming Discord messages: applies cooldowns, manages conversation threads,
 * updates memory, invokes AI reply generation, and persists conversation state.
 */

import { ConversationContext } from "@/types";
import { Client, Message } from "discord.js";
import OpenAI from "openai";
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

/**
 * Maximum number of messages before summarization occurs.
 */
const MESSAGE_LIMIT = 10;

// In-memory maps storing conversation histories and ID mappings per context (guild or user)
const histories = new Map<string, Map<string, ConversationContext>>();
const idMaps = new Map<string, Map<string, string>>();

/**
 * Creates and returns a handler function for new Discord messages.
 * Applies cooldowns, updates memory, threads conversations, and generates AI replies.
 *
 * @param openai - Initialized OpenAI client for chat completions.
 * @param client - Discord Client instance for sending replies.
 * @returns A function that processes a Message and may reply via the AI.
 */
export async function handleNewMessage(
  openai: OpenAI,
  client: Client
): Promise<(message: Message) => Promise<void>> {
  return async (message: Message): Promise<void> => {
    // Ignore bot messages and unwanted mass mentions
    if (message.author.bot) return;
    if (message.guild && message.mentions.everyone) return;

    // Determine if bot was mentioned or should interject randomly
    const mentioned = message.guild
      ? message.mentions.has(client.user!.id)
      : true;
    let interject = false;
    if (message.guild && !mentioned) {
      const fetched = await message.channel.messages.fetch({ limit: 6 });
      const lastFive = Array.from(fetched.values())
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .slice(1, 6);
      const botInLastFive = lastFive.some((m) => m.author.bot);
      if (!botInLastFive && Math.random() < 1 / 50) {
        interject = true;
      }
    }
    if (message.guild && !mentioned && !interject) return;

    // Show typing indicator
    if (message.channel.isTextBased() && "sendTyping" in message.channel) {
      message.channel.sendTyping().catch(() => {});
    }

    // Update clone user memory if message is from the clone user
    const userId = message.author.id;
    const guildId = message.guild?.id || null;
    if (userId === cloneUserId) {
      updateCloneMemory(userId, {
        timestamp: Date.now(),
        content: message.content,
      });
    }

    // Enforce cooldown
    const cdKey = getCooldownContext(guildId, userId);
    if (useCooldown && isCooldownActive(cdKey)) {
      const { cooldownTime } = getCooldownConfig(guildId);
      const warn = await message.reply(
        `⏳ Cooldown: ${cooldownTime.toFixed(2)}s`
      );
      setTimeout(() => warn.delete().catch(() => {}), cooldownTime * 1000);
      return;
    }
    if (useCooldown) manageCooldown(guildId, userId);

    // Prepare conversation threading
    const contextKey = guildId || userId;
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

    // Record user message in conversation history
    const convMap = histories.get(contextKey)!;
    if (!convMap.has(threadId)) convMap.set(threadId, { messages: new Map() });
    const conversation = convMap.get(threadId)!;
    conversation.messages.set(
      message.id,
      createChatMessage(message, "user", client.user?.username)
    );

    // Fetch recent channel history for context
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

    // Extract image and other URLs for context
    const imageUrls: string[] = Array.from(message.attachments.values())
      .filter((a) => a.contentType?.startsWith("image/"))
      .map((a) => a.url);
    const inlineImageUrls =
      message.content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)/gi) ?? [];
    inlineImageUrls.forEach((url) => {
      if (!imageUrls.includes(url)) imageUrls.push(url);
    });

    // Handle Tenor and Giphy links
    const tenorUrls =
      message.content.match(/https?:\/\/tenor\.com\/\S+/gi) ?? [];
    tenorUrls.forEach((url) => {
      if (!imageUrls.includes(url)) imageUrls.push(url);
    });
    const giphyUrls =
      message.content.match(/https?:\/\/(?:media\.)?giphy\.com\/\S+/gi) ?? [];
    giphyUrls.forEach((url) => {
      if (!imageUrls.includes(url)) imageUrls.push(url);
    });

    const allLinks = message.content.match(/https?:\/\/\S+/gi) ?? [];
    const genericUrls = allLinks.filter((url) => !imageUrls.includes(url));

    // Summarise conversation if too long
    if (conversation.messages.size >= MESSAGE_LIMIT) {
      const summary = summariseConversation(conversation);
      await updateUserMemory(userId, {
        timestamp: Date.now(),
        content: `🔖 ${summary}`,
      });
      conversation.messages.clear();
    }

    // Build replyToInfo tag (include interjection flag)
    let replyToInfo = `${message.author.username} said: "${message.content}"`;
    if (interject) replyToInfo = `🔀 Random interjection — ${replyToInfo}`;

    // Generate and send AI reply
    const { text, mathBuffers } = await generateReply(
      conversation.messages,
      message.id,
      openai,
      userId,
      replyToInfo,
      channelHistory,
      imageUrls,
      genericUrls
    );
    const attachments = mathBuffers.map((buf, i) => ({
      attachment: buf,
      name: `math-${i}.png`,
    }));
    const out = message.guild
      ? replaceEmojiShortcodes(text, message.guild)
      : text;
    const sent = await message.reply({ content: out, files: attachments });

    // Record assistant reply and persist
    conversation.messages.set(
      sent.id,
      createChatMessage(sent, "assistant", client.user?.username)
    );
    await updateUserMemory(userId, {
      timestamp: Date.now(),
      content: `Replied: ${text}`,
    });
    await saveConversations(histories, idMaps);
  };
}

/**
 * Preloads stored conversations for each guild on bot startup.
 *
 * @param client - Discord Client instance to enumerate guilds.
 */
export async function run(client: Client): Promise<void> {
  const guildIds = Array.from(client.guilds.cache.keys());
  await Promise.all(
    guildIds.map((g) => loadConversations(g, histories, idMaps))
  );
}
