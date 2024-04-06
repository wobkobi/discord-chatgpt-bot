type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  name: string;
  content: string;
  replyToId?: string;
};
export default ChatMessage;
