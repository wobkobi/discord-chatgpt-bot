export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  name: string;
  content: string;
  replyToId?: string;
}

export interface ConversationContext {
  messages: Map<string, ChatMessage>;
}
