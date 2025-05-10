/**
 * @file src/utils/discordHelpers.ts
 * @description Utilities for normalising Discord messages: fixing mentions, formatting markdown and maths,
 *   substituting emoji shortcodes, constructing chat message objects, summarising conversations,
 *   and stripping URL queries.
 *
 *   Ensures consistent formatting and context extraction for AI prompt construction.
 *   Emits detailed debug logs via logger.debug at each helper entry and exit.
 */

import { ChatMessage, ConversationContext } from "@/types";
import { Guild, Message } from "discord.js";
import logger from "./logger.js";

/**
 * Escape TeX sequences so they render correctly within Discord markdown by wrapping them in backticks.
 * @param text - Raw text potentially containing LaTeX bracket sequences.
 * @returns The input text with all `\[...\]` sequences escaped as ``\`[...\]`\``.
 */
function fixMathFormatting(text: string): string {
  const escaped = text.replace(/\\\[[^\]]*\\\]/g, (m) => `\`${m}\``);
  logger.debug(
    `[discordHelpers] fixMathFormatting result length=${escaped.length}`
  );
  return escaped;
}

/**
 * Normalise Discord mention syntax and remove stray '@' characters.
 * @param text - The raw message text containing Discord mentions.
 * @returns The text with unified mention format `<@id>` and no stray '@'.
 */
export function fixMentions(text: string): string {
  const result = text
    .replace(/<@!?(\d+)>/g, "<@$1>")
    .replace(/<(\d+)>/g, "<@$1>")
    .replace(/@/g, "");
  logger.debug(`[discordHelpers] fixMentions result length=${result.length}`);
  return result;
}

/**
 * Apply Discord markdown preprocessing:
 * 1. Normalise mentions
 * 2. Escape TeX maths sequences
 * @param text - The raw message text to format.
 * @returns The formatted text, safe for Discord display.
 */
export function applyDiscordMarkdownFormatting(text: string): string {
  const mentionsFixed = fixMentions(text);
  const formatted = fixMathFormatting(mentionsFixed);
  logger.debug(
    `[discordHelpers] applyDiscordMarkdownFormatting result length=${formatted.length}`
  );
  return formatted;
}

/**
 * Replace colon-based emoji shortcodes (e.g. `:smile:`) with actual guild emoji tags.
 * @param text  - The message text containing colon-based shortcodes.
 * @param guild - The Discord guild from which to resolve custom emoji.
 * @returns The text with shortcodes replaced by `<:name:id>` where available.
 */
export function replaceEmojiShortcodes(text: string, guild: Guild): string {
  const result = text.replace(/:([A-Za-z0-9_]+):/g, (_, name) => {
    const emoji = guild.emojis.cache.find((e) => e.name === name);
    return emoji ? `<:${emoji.name}:${emoji.id}>` : `:${name}:`;
  });
  logger.debug(
    `[discordHelpers] replaceEmojiShortcodes result length=${result.length}`
  );
  return result;
}

/**
 * Construct a standardised ChatMessage object from a Discord Message.
 * @param message - The original Discord message.
 * @param role    - Sender role in the conversation ('user' or 'assistant').
 * @param botName - Optional bot display name when role is 'assistant'.
 * @returns A ChatMessage containing id, role, name, content, optional replyToId, and any image attachments.
 */
export function createChatMessage(
  message: Message,
  role: "user" | "assistant",
  botName?: string
): ChatMessage {
  logger.debug(
    `[discordHelpers] createChatMessage invoked id=${message.id} role=${role}`
  );
  const name =
    role === "user"
      ? message.author.username.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)
      : (botName ?? "Bot");
  const attachmentUrls = message.attachments.size
    ? Array.from(message.attachments.values())
        .filter((a) => a.contentType?.startsWith("image/"))
        .map((a) => a.url)
    : undefined;
  const chatMsg: ChatMessage = {
    id: message.id,
    role,
    name,
    userId: role === "user" ? message.author.id : undefined,
    content: message.content,
    replyToId: message.reference?.messageId,
    attachmentUrls,
  };
  logger.debug(
    `[discordHelpers] createChatMessage constructed, content length=${chatMsg.content.length}`
  );
  return chatMsg;
}

/**
 * Summarise the last few messages in a conversation context for memory storage.
 * @param context - The ConversationContext containing message history.
 * @returns A concatenated string of the last three message contents.
 */
export function summariseConversation(context: ConversationContext): string {
  logger.debug(
    `[discordHelpers] summariseConversation invoked with ${context.messages.size} messages`
  );
  const summary = Array.from(context.messages.values())
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
  logger.debug(
    `[discordHelpers] summariseConversation result length=${summary.length}`
  );
  return summary;
}

/**
 * Strip query strings from a URL so comparison uses only origin and pathname.
 * @param url - The full URL potentially containing query parameters.
 * @returns The URL without its query string.
 */
export function stripQuery(url: string): string {
  logger.debug(`[discordHelpers] stripQuery invoked for url=${url}`);
  try {
    const u = new URL(url);
    const stripped = u.origin + u.pathname;
    logger.debug(`[discordHelpers] stripQuery result=${stripped}`);
    return stripped;
  } catch (err) {
    logger.warn(
      "[discordHelpers] stripQuery failed, returning original URL",
      err
    );
    return url;
  }
}
