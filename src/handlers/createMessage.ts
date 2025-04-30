import { ChatMessage, ConversationContext } from "@/types/types.js";
import { Client, Guild, Message } from "discord.js";
import "dotenv/config";
import OpenAI, { APIError } from "openai";
import { ChatCompletionMessageParam } from "openai/resources/index.js";
import { defaultCooldownConfig } from "../config.js";
import {
  cloneUserId,
  fixMathFormatting,
  getCharacterDescription,
  markdownGuide,
} from "../data/characterDescription.js";
import { cloneMemory, updateCloneMemory } from "../memory/cloneMemory.js";
import { updateUserMemory, userMemory } from "../memory/userMemory.js";
import {
  getCooldownContext,
  isCooldownActive,
  manageCooldown,
  useCooldown,
} from "../utils/cooldown.js";
import {
  loadConversations,
  markContextUpdated,
  saveConversations,
} from "../utils/fileUtils.js";
import { renderLatexToPng } from "../utils/latexRenderer.js";
import logger from "../utils/logger.js";

const MESSAGE_LIMIT = 10;

// ---------------------------------------------
// Helpers
// ---------------------------------------------

function fixMentions(text: string): string {
  return text
    .replace(/<@!?(\d+)>/g, "<@$1>")
    .replace(/<(\d+)>/g, "<@$1>")
    .replace(/@/g, "");
}

function applyDiscordMarkdownFormatting(text: string): string {
  return fixMathFormatting(fixMentions(text));
}

function replaceEmojiShortcodes(text: string, guild: Guild): string {
  return text.replace(/:([a-zA-Z0-9_]+):/g, (_, name) => {
    const e = guild.emojis.cache.find((e) => e.name === name);
    return e ? `<:${e.name}:${e.id}>` : `:${name}:`;
  });
}

function createChatMessage(
  message: Message,
  role: "user" | "assistant",
  botName?: string
): ChatMessage {
  const name =
    role === "user"
      ? message.author.username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
      : (botName ?? "Bot");
  return {
    id: message.id,
    role,
    name,
    userId: role === "user" ? message.author.id : undefined,
    content: message.content,
    replyToId: message.reference?.messageId,
  };
}

function summariseConversation(context: ConversationContext): string {
  return Array.from(context.messages.values())
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
}

// ---------------------------------------------
// Multimodal Reply Generation
// ---------------------------------------------

export async function generateReply(
  convoHistory: Map<string, ChatMessage>,
  currentId: string,
  openai: OpenAI,
  userId: string,
  replyToInfo?: string,
  channelHistory?: string,
  imageUrls: string[] = [],
  genericUrls: string[] = []
): Promise<{ text: string; mathBuffers: Buffer[] }> {
  const useFT = process.env.USE_FINE_TUNED_MODEL === "true";
  const modelName = useFT
    ? process.env.FINE_TUNED_MODEL_NAME ||
      (logger.error("FINE_TUNED_MODEL_NAME missing, exiting."),
      process.exit(1),
      "")
    : "gpt-4o";

  const messages: ChatCompletionMessageParam[] = [];

  // Persona + memory
  if (process.env.USE_PERSONA === "true") {
    const persona = await getCharacterDescription(userId);
    messages.push({ role: "system", content: persona });

    const memArr =
      userId === cloneUserId
        ? cloneMemory.get(userId) || []
        : userMemory.get(userId) || [];
    if (memArr.length) {
      const prefix =
        userId === cloneUserId ? "Clone memory:\n" : "Long-term memory:\n";
      messages.push({
        role: "system",
        content: prefix + memArr.map((e) => e.content).join("\n"),
      });
    }
  }

  // Reply context
  if (replyToInfo) messages.push({ role: "system", content: replyToInfo });
  // Channel history
  if (channelHistory)
    messages.push({
      role: "system",
      content: `Recent channel history:\n${channelHistory}`,
    });

  // Always include markdown guide
  messages.push({ role: "system", content: markdownGuide });

  // Flatten thread
  const lines: string[] = [];
  let cursor: string | undefined = currentId;
  while (cursor) {
    const turn = convoHistory.get(cursor);
    if (!turn) break;
    const clean = fixMathFormatting(fixMentions(turn.content));
    lines.unshift(
      turn.role === "user" ? `${turn.name} asked: ${clean}` : clean
    );
    cursor = turn.replyToId;
  }
  // Append attachments & links
  for (const url of imageUrls) {
    lines.push(`[image] ${url}`);
  }
  // Append generic link URLs
  for (const url of genericUrls) {
    lines.push(`[link]  ${url}`);
  }

  // Final user message
  messages.push({
    role: "user",
    content: lines.join("\n"),
  });

  messages.push({ role: "user", content: lines.join("\n") });

  logger.info(
    `📝 Prompt → model=${modelName}, lines=${lines.length}\n` +
      `Prompt context:\n${JSON.stringify(messages, null, 2)}`
  );

  let content: string;
  try {
    const res = await openai.chat.completions.create({
      model: modelName,
      messages,
      top_p: 0.6,
      frequency_penalty: 0.5,
      max_tokens: 2000,
    });

    content = res.choices[0]?.message.content?.trim() ?? "";
    if (!content) throw new Error("Empty AI response");
  } catch (err: unknown) {
    if (useFT && err instanceof APIError && err.code === "model_not_found") {
      logger.error(`Fine-tuned model not found: ${modelName}`);
      process.exit(1);
    }
    logger.error("OpenAI error:", err);
    if (err instanceof APIError && err.code === "insufficient_quota") {
      return { text: "⚠️ Out of quota.", mathBuffers: [] };
    }
    throw err;
  }
  const mathBuffers: Buffer[] = [];
  const mathRegex = /\\\[(.+?)\\\]/g;
  let match: RegExpExecArray | null;
  let reply = content;
  while ((match = mathRegex.exec(content)) !== null) {
    const expr = match[1].trim();
    try {
      const buf = await renderLatexToPng(expr);
      mathBuffers.push(buf);
      reply = reply.replace(match[0], "");
    } catch (e) {
      console.error("Math→PNG failed:", e);
    }
  }

  return { text: reply.trim(), mathBuffers };
}

// ---------------------------------------------
// Message handler
// ---------------------------------------------

const histories = new Map<string, Map<string, ConversationContext>>();
const idMaps = new Map<string, Map<string, string>>();

export async function handleNewMessage(
  openai: OpenAI,
  client: Client
): Promise<(message: Message) => Promise<void>> {
  return async (message: Message): Promise<void> => {
    // Ignore bots and @everyone
    if (message.author.bot) return;
    if (message.guild && message.mentions.everyone) return;

    // Mention vs. random interjection
    const mentioned = message.guild
      ? message.mentions.has(client.user!.id)
      : true;
    const interject = message.guild && !mentioned && Math.random() < 1 / 50;
    if (message.guild && !mentioned && !interject) return;

    // Typing indicator
    if (message.channel.isTextBased() && "sendTyping" in message.channel) {
      message.channel.sendTyping().catch(() => {});
    }

    const userId = message.author.id;
    const guildId = message.guild?.id || null;

    if (userId === cloneUserId) {
      updateCloneMemory(userId, {
        timestamp: Date.now(),
        content: message.content,
      });
    }

    // Cooldown
    const cdKey = getCooldownContext(guildId, userId);
    if (useCooldown && isCooldownActive(cdKey)) {
      const cd = defaultCooldownConfig.cooldownTime.toFixed(2);
      const warn = await message.reply(`⏳ Cooldown: ${cd}s`);
      setTimeout(() => warn.delete().catch(() => {}), 5000);
      return;
    }
    if (useCooldown) manageCooldown(guildId, userId);

    const contextKey = guildId || userId;
    if (!histories.has(contextKey)) {
      histories.set(contextKey, new Map());
      idMaps.set(contextKey, new Map());
    }
    markContextUpdated(contextKey);
    const convIds = idMaps.get(contextKey)!;

    // Determine thread ID
    const replyToId = message.reference?.messageId;
    const threadId =
      replyToId && convIds.has(replyToId)
        ? convIds.get(replyToId)!
        : `${message.channel.id}-${message.id}`;
    convIds.set(message.id, threadId);

    // Get or create conversation
    const convMap = histories.get(contextKey)!;
    if (!convMap.has(threadId)) convMap.set(threadId, { messages: new Map() });

    // Record user message
    const conversation = convMap.get(threadId)!;
    conversation.messages.set(
      message.id,
      createChatMessage(message, "user", client.user?.username)
    );

    // Fetch recent channel history
    let channelHistory: string | undefined;
    if (message.guild) {
      try {
        const fetched = await message.channel.messages.fetch({ limit: 50 });
        channelHistory = Array.from(fetched.values())
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map((m) => `${m.author.username}: ${m.content}`)
          .join("\n");
      } catch (err) {
        logger.error("Failed to fetch channel history:", err);
      }
    }

    // Gather attachment images
    const imageUrls: string[] = Array.from(message.attachments.values())
      .filter((a) => a.contentType?.startsWith("image/"))
      .map((a) => a.url);

    // Inline static image URLs
    const inlineImageUrls: string[] =
      message.content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)/gi) ?? [];
    inlineImageUrls.forEach((url: string) => {
      if (!imageUrls.includes(url)) imageUrls.push(url);
    });

    // Tenor → download.gif
    const tenorLinks: string[] =
      message.content.match(/https?:\/\/tenor\.com\/view\/[^\s]+/gi) ?? [];
    tenorLinks.forEach((link: string) => {
      const base = link.replace(/\/download(?:\.\w+)?$/, "");
      const gifUrl = `${base}/download.gif`;
      if (!imageUrls.includes(gifUrl)) imageUrls.push(gifUrl);
    });

    // Giphy → media.giphy.com
    const giphyLinks: string[] =
      message.content.match(/https?:\/\/giphy\.com\/gifs\/[^\s]+/gi) ?? [];
    giphyLinks.forEach((link: string) => {
      const id = link.split("/").pop();
      if (id) {
        const gifUrl = `https://media.giphy.com/media/${id}/giphy.gif`;
        if (!imageUrls.includes(gifUrl)) imageUrls.push(gifUrl);
      }
    });

    // All other URLs
    const allLinks: string[] = message.content.match(/https?:\/\/\S+/gi) ?? [];
    const genericUrls: string[] = allLinks.filter(
      (url) =>
        !imageUrls.includes(url) &&
        !inlineImageUrls.includes(url) &&
        !tenorLinks.includes(url) &&
        !giphyLinks.includes(url)
    );

    // Summarise if too long
    if (conversation.messages.size >= MESSAGE_LIMIT) {
      const summary = summariseConversation(conversation);
      await updateUserMemory(userId, {
        timestamp: Date.now(),
        content: `🔖 ${summary}`,
      });
      conversation.messages.clear();
    }

    // Build replyToInfo tag (mark interjection)
    let replyToInfo = `${message.author.username} said: "${message.content}"`;
    if (interject) replyToInfo = `🔀 Random interjection — ${replyToInfo}`;

    const { text, mathBuffers } = await generateReply(
      conversation.messages,
      message.id,
      openai,
      userId,
      replyToInfo,
      channelHistory,
      imageUrls,
      genericUrls
    );

    // send math images
    for (let i = 0; i < mathBuffers.length; i++) {
      await message.reply({
        files: [{ attachment: mathBuffers[i], name: `math${i}.png` }],
      });
    }

    // Format & send
    const out = applyDiscordMarkdownFormatting(text);
    const sent = await message.reply(
      message.guild ? replaceEmojiShortcodes(out, message.guild) : out
    );

    // Record assistant reply
    conversation.messages.set(
      sent.id,
      createChatMessage(sent, "assistant", client.user?.username)
    );

    // Persist memory & conversations
    await updateUserMemory(userId, {
      timestamp: Date.now(),
      content: `Replied: ${out}`,
    });
    await saveConversations(histories, idMaps);
  };
}

export async function run(client: Client): Promise<void> {
  const guildIds = Array.from(client.guilds.cache.keys());
  // Load stored conversations for each guild context
  await Promise.all(
    guildIds.map((g) => loadConversations(g, histories, idMaps))
  );
}
