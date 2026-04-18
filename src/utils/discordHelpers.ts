/**
 * @file src/utils/discordHelpers.ts
 * @description Utilities for normalising Discord messages: fixing mentions, formatting markdown and maths,
 *   substituting emoji shortcodes, constructing chat message objects, summarising conversations,
 *   and stripping URL queries.
 */

import { ChatMessage, ConversationContext } from "@/types/chat.js";
import logger from "@/utils/logger.js";
import { Guild, Message } from "discord.js";

/**
 * Escape TeX sequences so they render correctly within Discord markdown by wrapping them in backticks.
 * @param text - Raw text potentially containing LaTeX bracket sequences.
 * @returns The input text with all `\[...\]` sequences escaped.
 */
function fixMathFormatting(text: string): string {
  return text.replace(/\\\[[^\]]*\\\]/g, (m) => `\`${m}\``);
}

/**
 * Normalise Discord mention syntax and remove stray '@' characters.
 * @param text - The raw message text containing Discord mentions.
 * @returns The text with unified mention format `<@id>` and no stray '@'.
 */
function fixMentions(text: string): string {
  return text
    .replace(/<@!?(\d+)>/g, "<@$1>")
    .replace(/<(\d+)>/g, "<@$1>")
    .replace(/@/g, "");
}

/**
 * Apply Discord markdown preprocessing: normalise mentions then escape TeX maths sequences.
 * @param text - The raw message text to format.
 * @returns The formatted text, safe for Discord display.
 */
export function applyDiscordMarkdownFormatting(text: string): string {
  return fixMathFormatting(fixMentions(text));
}

/**
 * Replace colon-based emoji shortcodes (e.g. `:smile:`) with actual guild emoji tags.
 * @param text - The message text containing colon-based shortcodes.
 * @param guild - The Discord guild from which to resolve custom emoji.
 * @returns The text with shortcodes replaced by `<:name:id>` where available.
 */
export function replaceEmojiShortcodes(text: string, guild: Guild): string {
  return text.replace(/:([A-Za-z0-9_]+):/g, (_, name) => {
    const emoji = guild.emojis.cache.find((e) => e.name === name);
    return emoji ? `<:${emoji.name}:${emoji.id}>` : `:${name}:`;
  });
}

/**
 * Construct a standardised ChatMessage object from a Discord Message.
 * @param message - The original Discord message.
 * @param role - Sender role in the conversation ('user' or 'assistant').
 * @param botName - Optional bot display name when role is 'assistant'.
 * @returns A ChatMessage containing id, role, name, content, optional replyToId, and any image attachments.
 */
export function createChatMessage(
  message: Message,
  role: "user" | "assistant",
  botName?: string,
): ChatMessage {
  const name =
    role === "user"
      ? message.author.username.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)
      : (botName ?? "Bot");
  const attachmentUrls = message.attachments.size
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
 * @param context - The ConversationContext containing message history.
 * @returns A concatenated string of the last three message contents.
 */
export function summariseConversation(context: ConversationContext): string {
  return Array.from(context.messages.values())
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
}

/**
 * Strip query strings from a URL so comparison uses only origin and pathname.
 * @param url - The full URL potentially containing query parameters.
 * @returns The URL without its query string.
 */
export function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    logger.warn("[discordHelpers] stripQuery: invalid URL, returning original", url);
    return url;
  }
}
