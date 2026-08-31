// src/utils/discordHelpers.ts
/**
 * @description Utilities for normalising Discord messages: fixing mentions, formatting markdown and maths,
 *   substituting emoji shortcodes, constructing chat message objects, summarising conversations,
 *   and stripping URL queries.
 */

import { ChatMessage, ConversationContext } from "@/types/chat";
import logger from "@/utils/logger";
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
 * Resolve every emote reference in a message against the guild's live emoji cache.
 *
 * The model writes shortcodes in whatever case it feels like - usually all lowercase, since
 * that is the convention for built-in emoji - so `:britishcat:` has to resolve the emote named
 * `britishCat` rather than ship as literal text. An exact match still wins, because a guild may
 * hold two emotes whose names differ only by case.
 *
 * Shortcodes and already-written tags are matched in one alternation so a well-formed
 * `<:name:id>` is consumed whole. Matching shortcodes on their own rewrites the `:name:` nested
 * inside such a tag and yields `<<:name:id>id>`, which renders as nothing.
 *
 * A tag is re-resolved by name rather than trusted, because an emote that has since been renamed,
 * deleted or re-uploaded carries a dead ID. Resolution goes through `emoji.toString()`, which
 * supplies the `a:` prefix animated emotes require - an animated emote sent as a static
 * `<:name:id>` tag does not render.
 *
 * References that resolve to nothing are dropped along with their leading whitespace, since a
 * literal `:name:` or a dead tag is noise to the reader. All-digit shortcodes are left untouched
 * so clock times such as `10:30:45` survive.
 * @param text - The message text containing shortcodes or emote tags.
 * @param guild - The Discord guild from which to resolve custom emoji.
 * @returns The text with each reference replaced by a live tag, and unresolvable ones removed.
 */
export function replaceEmojiShortcodes(text: string, guild: Guild): string {
  const resolve = (name: string): string | null => {
    const lower = name.toLowerCase();
    const emoji =
      guild.emojis.cache.find((e) => e.name === name) ??
      guild.emojis.cache.find((e) => e.name?.toLowerCase() === lower);
    return emoji ? emoji.toString() : null;
  };

  return text
    .replace(
      /(\s*)(?:<a?:([A-Za-z0-9_]+):\d+>|:([A-Za-z0-9_]{2,}):)/g,
      (match: string, space: string, tagName?: string, shortcode?: string) => {
        const name = tagName ?? shortcode;
        if (!name) return match;
        // A bare :30: is a timestamp fragment, not an emote; only tags may be all digits
        if (!tagName && !/[A-Za-z_]/.test(name)) return match;
        const tag = resolve(name);
        return tag ? `${space}${tag}` : "";
      },
    )
    .trim();
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
