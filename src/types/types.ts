// src/types/types.ts

/**
 * src/types/types.ts
 *
 * Shared types for chat messages, conversation contexts, and memory entries.
 */

/**
 * Allowed roles for chat messages.
 */
export type Role = "user" | "assistant";

/**
 * A single entry for long-term memory (user or clone).
 */
export interface GeneralMemoryEntry {
  /** When this entry was recorded (ms since UNIX epoch). */
  timestamp: number;
  /** The memory content or summary to be preserved. */
  content: string;
}

/**
 * Represents a single chat message in a conversation.
 */
export interface ChatMessage {
  /** Discord message ID */
  id: string;
  /** Origin of the message: user or assistant */
  role: Role;
  /** Sanitised display name (username or bot name) */
  name: string;
  /** Discord user ID (only for user-sent messages) */
  userId?: string;
  /** Raw text content of the message */
  content: string;
  /** Parent message ID if this message is a reply */
  replyToId?: string;
  /** Any attachment URLs (images, GIFs, etc.) included with the message */
  attachmentUrls?: string[];
}

/**
 * Holds the full message history for a given conversation thread.
 */
export interface ConversationContext {
  /** Map from message ID to the corresponding ChatMessage */
  messages: Map<string, ChatMessage>;
}
