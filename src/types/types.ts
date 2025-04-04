/**
 * Represents a single chat message in a conversation.
 */
export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  name: string;
  userId?: string;
  content: string;
  replyToId?: string;
}

/**
 * Represents the context of a conversation, holding all its messages.
 */
export interface ConversationContext {
  messages: Map<string, ChatMessage>;
}

/**
 * Represents a generic memory entry with a timestamp and content.
 */
export interface GeneralMemoryEntry {
  timestamp: number;
  content: string;
}
