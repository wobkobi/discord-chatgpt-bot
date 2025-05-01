import { ChatMessage, ConversationContext } from "@/types";
import { Guild, Message } from "discord.js";
import { fixMathFormatting } from "../services/characterService.js";

/**
 * Normalise Discord mention syntax and strip stray '@'.
 */
export function fixMentions(text: string): string {
  return text
    .replace(/<@!?(\\d+)>/g, "<@$1>")
    .replace(/<(\\d+)>/g, "<@$1>")
    .replace(/@/g, "");
}

/**
 * Apply Discord markdown rules and escape math formatting.
 */
export function applyDiscordMarkdownFormatting(text: string): string {
  return fixMathFormatting(fixMentions(text));
}

/**
 * Replace colon-based shortcodes with actual guild emoji tags.
 */
export function replaceEmojiShortcodes(text: string, guild: Guild): string {
  return text.replace(/:([A-Za-z0-9_]+):/g, (_, name) => {
    const e = guild.emojis.cache.find((e) => e.name === name);
    return e ? `<:${e.name}:${e.id}>` : `:${name}:`;
  });
}

/**
 * Construct a ChatMessage object from a Discord Message.
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
  return {
    id: message.id,
    role,
    name,
    userId: role === "user" ? message.author.id : undefined,
    content: message.content,
    replyToId: message.reference?.messageId,
  };
}

/**
 * Summarise the last few messages of a conversation for memory.
 */
export function summariseConversation(context: ConversationContext): string {
  return Array.from(context.messages.values())
    .slice(-3)
    .map((m) => m.content)
    .join("\\n");
}
