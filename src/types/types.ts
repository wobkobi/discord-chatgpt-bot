export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  name: string;
  content: string;
  replyToId?: string;
};

export type ConversationContext = {
  messages: Map<string, ChatMessage>;
};
