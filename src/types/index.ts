/**
 * @file src/types/index.ts
 * @description Central TypeScript type definitions for Discord messages, memory entries, and conversation context.
 */

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
 * Standardized chat message object used for AI conversation context.
 */
export interface ChatMessage {
  /** Unique message ID (Discord message ID). */
  id: string;
  /** Role of the sender in the conversation. */
  role: ChatRole;
  /** Display name of the sender (username or bot name). */
  name: string;
  /** Discord user ID of the sender; present for user messages. */
  userId?: string;
  /** The cleaned content of the message, with markdown applied. */
  content: string;
  /** Any attachment URLs (images, GIFs, etc.) included with the message */
  attachmentUrls?: string[];
  /** ID of the message this one is replying to, if any, to maintain threading. */
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
 * Configuration record saved for each guild to manage cooldown behavior.
 */
export interface GuildCooldownConfig {
  /** Flag indicating if cooldown is enabled for the guild. */
  useCooldown: boolean;
  /** Duration of each cooldown period, in seconds. */
  cooldownTime: number;
  /** Apply cooldown per user if true, otherwise globally. */
  perUserCooldown: boolean;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };
