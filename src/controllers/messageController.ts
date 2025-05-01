import { ConversationContext } from "@/types";
import { Client, Message } from "discord.js";
import OpenAI from "openai";
import { defaultCooldownConfig } from "../config/index.js";
import { cloneUserId } from "../services/characterService.js";
import { generateReply } from "../services/replyService.js";
import { updateCloneMemory } from "../store/cloneMemory.js";
import { updateUserMemory } from "../store/userMemory.js";
import {
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
import {
  loadConversations,
  markContextUpdated,
  saveConversations,
} from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

const MESSAGE_LIMIT = 10;
const histories = new Map<string, Map<string, ConversationContext>>();
const idMaps = new Map<string, Map<string, string>>();

/**
 * Returns a function that handles incoming Discord messages,
 * applies cooldowns, updates memory, generates replies, and sends them.
 */
export async function handleNewMessage(
  openai: OpenAI,
  client: Client
): Promise<(message: Message) => Promise<void>> {
  return async (message: Message): Promise<void> => {
    // ignore bots & mass mentions
    if (message.author.bot) return;
    if (message.guild && message.mentions.everyone) return;

    // decide whether to respond
    const mentioned = message.guild
      ? message.mentions.has(client.user!.id)
      : true;
    const interject = message.guild && !mentioned && Math.random() < 1 / 50;
    if (message.guild && !mentioned && !interject) return;

    // show typing
    if (message.channel.isTextBased() && "sendTyping" in message.channel) {
      message.channel.sendTyping().catch(() => {});
    }

    // update clone memory if applicable
    const userId = message.author.id;
    const guildId = message.guild?.id || null;
    if (userId === cloneUserId) {
      updateCloneMemory(userId, {
        timestamp: Date.now(),
        content: message.content,
      });
    }

    // cooldown enforcement
    const cdKey = getCooldownContext(guildId, userId);
    if (useCooldown && isCooldownActive(cdKey)) {
      const cd = defaultCooldownConfig.cooldownTime.toFixed(2);
      const warn = await message.reply(`⏳ Cooldown: ${cd}s`);
      setTimeout(() => warn.delete().catch(() => {}), 5000);
      return;
    }
    if (useCooldown) manageCooldown(guildId, userId);

    // conversation threading setup
    const contextKey = guildId || userId;
    if (!histories.has(contextKey)) {
      histories.set(contextKey, new Map());
      idMaps.set(contextKey, new Map());
    }
    markContextUpdated(contextKey);
    const convIds = idMaps.get(contextKey)!;
    const replyToId = message.reference?.messageId;
    const threadId =
      replyToId && convIds.has(replyToId)
        ? convIds.get(replyToId)!
        : `${message.channel.id}-${message.id}`;
    convIds.set(message.id, threadId);

    // record user message
    const convMap = histories.get(contextKey)!;
    if (!convMap.has(threadId)) convMap.set(threadId, { messages: new Map() });
    const conversation = convMap.get(threadId)!;
    conversation.messages.set(
      message.id,
      createChatMessage(message, "user", client.user?.username)
    );

    // Fetch recent channel history
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

    // Gather attachment images
    const imageUrls: string[] = Array.from(message.attachments.values())
      .filter((a) => a.contentType?.startsWith("image/"))
      .map((a) => a.url);

    // Inline static image URLs
    const inlineImageUrls: string[] =
      message.content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)/gi) ?? [];
    inlineImageUrls.forEach((url: string) => {
      if (!imageUrls.includes(url)) imageUrls.push(url);
    });

    // Tenor → download.gif
    const tenorLinks: string[] =
      message.content.match(/https?:\/\/tenor\.com\/view\/[^\s]+/gi) ?? [];
    tenorLinks.forEach((link: string) => {
      const base = link.replace(/\/download(?:\.\w+)?$/, "");
      const gifUrl = `${base}/download.gif`;
      if (!imageUrls.includes(gifUrl)) imageUrls.push(gifUrl);
    });

    // Giphy → media.giphy.com
    const giphyLinks: string[] =
      message.content.match(/https?:\/\/giphy\.com\/gifs\/[^\s]+/gi) ?? [];
    giphyLinks.forEach((link: string) => {
      const id = link.split("/").pop();
      if (id) {
        const gifUrl = `https://media.giphy.com/media/${id}/giphy.gif`;
        if (!imageUrls.includes(gifUrl)) imageUrls.push(gifUrl);
      }
    });

    // All other URLs
    const allLinks: string[] = message.content.match(/https?:\/\/\S+/gi) ?? [];
    const genericUrls: string[] = allLinks.filter(
      (url) =>
        !imageUrls.includes(url) &&
        !inlineImageUrls.includes(url) &&
        !tenorLinks.includes(url) &&
        !giphyLinks.includes(url)
    );

    // Summarise if too long
    if (conversation.messages.size >= MESSAGE_LIMIT) {
      const summary = summariseConversation(conversation);
      await updateUserMemory(userId, {
        timestamp: Date.now(),
        content: `🔖 ${summary}`,
      });
      conversation.messages.clear();
    }

    // Build replyToInfo tag (mark interjection)
    let replyToInfo = `${message.author.username} said: "${message.content}"`;
    if (interject) replyToInfo = `🔀 Random interjection — ${replyToInfo}`;

    // generate and send reply
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
    const out = text;
    const sent = await message.reply({
      content: message.guild ? replaceEmojiShortcodes(out, message.guild) : out,
      files: attachments,
    });

    conversation.messages.set(
      sent.id,
      createChatMessage(sent, "assistant", client.user?.username)
    );

    // persist memory & logs
    await updateUserMemory(userId, {
      timestamp: Date.now(),
      content: `Replied: ${out}`,
    });
    await saveConversations(histories, idMaps);
  };
}

/**
 * Preload stored conversations for each guild on startup.
 */
export async function run(client: Client): Promise<void> {
  const guildIds = Array.from(client.guilds.cache.keys());
  await Promise.all(
    guildIds.map((g) => loadConversations(g, histories, idMaps))
  );
}
