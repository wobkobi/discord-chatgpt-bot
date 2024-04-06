import ChatMessage from "./chatMessage.js";

type ConversationContext = {
  messages: Map<string, ChatMessage>;
};
export default ConversationContext;
