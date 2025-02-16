export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  name: string;
  userId?: string;
  content: string;
  replyToId?: string;
}

export interface ConversationContext {
  messages: Map<string, ChatMessage>;
}

export interface GeneralMemoryEntry {
  timestamp: number;
  content: string;
}
