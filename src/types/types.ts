export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  name: string;
  userId?: string; // New: the Discord user ID (for user messages)
  content: string;
  replyToId?: string;
}

export interface ConversationContext {
  messages: Map<string, ChatMessage>;
}

// New interface for general memory entries
export interface GeneralMemoryEntry {
  timestamp: number;
  content: string;
}
