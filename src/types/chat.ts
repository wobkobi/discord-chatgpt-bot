/** Role of a chat message */
export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  name: string;
  userId?: string;
  content: string;
  attachmentUrls?: string[];
  replyToId?: string;
}

export interface ConversationContext {
  messages: Map<string, ChatMessage>;
}
