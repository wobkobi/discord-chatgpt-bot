/**
 * @file src/utils/discordHelpers.ts
 * @description Utilities for normalising Discord messages: fixing mentions, formatting markdown/math,
 *   substituting emoji shortcodes, constructing chat message objects, summarising conversations, and stripping URL queries.
 * @remarks
 *   Ensures consistent formatting and context extraction for AI prompt construction.
 */

import { ChatMessage, ConversationContext } from "@/types";
import { Guild, Message } from "discord.js";
import { fixMathFormatting } from "../services/characterService.js";

/**
 * Normalise Discord mention syntax and remove stray '@' characters.
 *
 * @param text - The raw message text containing Discord mentions.
 * @returns The text with unified mention format (<@id>) and no stray '@'.
 */
export function fixMentions(text: string): string {
  return text
    .replace(/<@!?(\d+)>/g, "<@$1>")
    .replace(/<(\d+)>/g, "<@$1>")
    .replace(/@/g, "");
}

/**
 * Apply Discord markdown preprocessing:
 * 1. Normalise mentions
 * 2. Escape TeX math sequences for Discord
 *
 * @param text - The raw message text to format.
 * @returns The formatted text safe for Discord display.
 */
export function applyDiscordMarkdownFormatting(text: string): string {
  return fixMathFormatting(fixMentions(text));
}

/**
 * Replace colon-based emoji shortcodes (e.g. :smile:) with actual guild emoji tags.
 *
 * @param text - The message text containing colon-based shortcodes.
 * @param guild - The Discord guild context for resolving custom emoji.
 * @returns The text with shortcodes replaced by <:name:id> where available.
 */
export function replaceEmojiShortcodes(text: string, guild: Guild): string {
  return text.replace(/:([A-Za-z0-9_]+):/g, (_, name) => {
    const emoji = guild.emojis.cache.find((e) => e.name === name);
    return emoji ? `<:${emoji.name}:${emoji.id}>` : `:${name}:`;
  });
}

/**
 * Construct a standardised ChatMessage object from a Discord Message.
 *
 * @param message - The original Discord message.
 * @param role - Role of the sender in conversation ('user' or 'assistant').
 * @param botName - Optional bot display name to use when role is 'assistant'.
 * @returns A ChatMessage containing id, role, name, content, optional replyToId, and attachment URLs.
 */
export function createChatMessage(
  message: Message,
  role: "user" | "assistant",
  botName?: string
): ChatMessage {
  const name =
    role === "user"
      ? message.author.username.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)
      : (botName ?? "Bot");

  const attachmentUrls =
    message.attachments.size > 0
      ? Array.from(message.attachments.values())
          .filter((a) => a.contentType?.startsWith("image/"))
          .map((a) => a.url)
      : undefined;

  return {
    id: message.id,
    role,
    name,
    userId: role === "user" ? message.author.id : undefined,
    content: message.content,
    replyToId: message.reference?.messageId,
    attachmentUrls,
  };
}

/**
 * Summarise the last few messages in a conversation context for memory storage.
 *
 * @param context - The ConversationContext containing message history.
 * @returns A concatenated string of the most recent messages' content.
 */
export function summariseConversation(context: ConversationContext): string {
  return Array.from(context.messages.values())
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
}

/**
 * Strip off query strings from a URL so comparison is based on origin and pathname only.
 *
 * @param url - The full URL potentially containing query parameters.
 * @returns The URL without its query string.
 */
export function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}
