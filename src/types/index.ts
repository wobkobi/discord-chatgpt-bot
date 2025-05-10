/**
 * @file src/types/index.ts
 * @description Central TypeScript type definitions for Discord messages, memory entries, and conversation context.
 *
 *   Standardises how messages, memory logs, and guild settings are represented throughout the bot.
 *   Includes debug logging to confirm type module has been loaded.
 */

import logger from "../utils/logger.js";

/**
 * Represents a single memory entry for storing user or clone recollections.
 */
export interface GeneralMemoryEntry {
  /** Unix timestamp (in milliseconds) when the entry was recorded. */
  timestamp: number;
  /** Text content of the memory entry. */
  content: string;
}

/**
 * Role of a chat message within a conversation thread.
 */
export type ChatRole = "user" | "assistant";

/**
 * Standardised chat message object used for AI conversation context.
 */
export interface ChatMessage {
  /** Unique message ID (Discord message ID). */
  id: string;
  /** Role of the sender in the conversation. */
  role: ChatRole;
  /** Display name of the sender (e.g., username or bot name). */
  name: string;
  /** Discord user ID of the sender; present for user messages. */
  userId?: string;
  /** The cleaned content of the message, with Markdown formatting applied. */
  content: string;
  /** URLs of any attachments (images, documents, etc.) included with the message. */
  attachmentUrls?: string[];
  /** ID of the message this one is replying to, if any, to maintain threading context. */
  replyToId?: string;
}

/**
 * Context for an ongoing conversation thread, mapping message IDs to chat messages.
 */
export interface ConversationContext {
  /** Ordered map of message IDs to ChatMessage entries. */
  messages: Map<string, ChatMessage>;
}

/**
 * Configuration record saved for each guild to manage message cooldown behaviour.
 */
export interface GuildCooldownConfig {
  /** Flag indicating if cooldown logic is enabled for the guild. */
  useCooldown: boolean;
  /** Duration of each cooldown period, in seconds. */
  cooldownTime: number;
  /** If true, applies cooldown separately per user; otherwise globally. */
  perUserCooldown: boolean;
}

/**
 * A content block representing text, an image URL, or a file upload for multimodal AI input.
 */
export type Block =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

// Debug: confirm type definitions loaded
logger.debug("[types] Loaded central type definitions");
