/**
 * @file src/utils/urlExtractor/extractDiscord.ts
 * @description Captures Discord stickers and attachments, converting them into ChatGPT Blocks.
 *
 *   - extractStickers: transforms message.stickers into image_url blocks.
 *   - extractAttachments: processes images, PDFs, text files and other attachments,
 *     embedding or skipping based on content type.
 *   Includes detailed debug logs via logger.debug.
 */
import { Block } from "@/types";
import { Message } from "discord.js";
import fetch from "node-fetch";
import { stripQuery } from "../discordHelpers.js";
import logger from "../logger.js";

/**
 * Captures Discord sticker images as image_url blocks.
 * @param message - The incoming Discord.js Message.
 * @param blocks - Array to append Block objects.
 * @param seen - Set of image URL keys already processed.
 */
export function extractStickers(
  message: Message,
  blocks: Block[],
  seen: Set<string>
): void {
  logger.debug("[extractDiscord] extractStickers invoked");
  for (const sticker of message.stickers.values()) {
    const url = sticker.url;
    blocks.push({ type: "image_url", image_url: { url } });
    seen.add(stripQuery(url));
    logger.debug(`[extractDiscord] Sticker URL added: ${url}`);
  }
}

/**
 * Processes message attachments, embedding or skipping based on type:
 * - Images: added as image_url blocks.
 * - PDFs: fetched and embedded as base64 files.
 * - Text: fetched and embedded as code blocks (truncated at 8000 chars).
 * - Others: skipped.
 * @param message - The incoming Discord.js Message.
 * @param blocks - Array to append Block objects.
 * @param seen - Set of URL keys already processed.
 */
export async function extractAttachments(
  message: Message,
  blocks: Block[],
  seen: Set<string>
): Promise<void> {
  logger.debug("[extractDiscord] extractAttachments invoked");
  for (const att of message.attachments.values()) {
    const url = att.url;
    const key = stripQuery(url);
    const ct = att.contentType ?? "application/octet-stream";
    const name = att.name ?? "file";
    logger.debug(`[extractDiscord] Attachment detected: ${url} (type=${ct})`);

    if (ct.startsWith("image/")) {
      blocks.push({ type: "image_url", image_url: { url } });
      seen.add(key);
      logger.debug(`[extractDiscord] Image attachment added: ${url}`);
    } else if (ct === "application/pdf") {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        blocks.push({
          type: "file",
          file: { filename: name, file_data: `data:${ct};base64,${b64}` },
        });
        seen.add(key);
        logger.debug(`[extractDiscord] PDF embedded: ${url}`);
      } catch (err) {
        logger.warn(`[extractDiscord] Failed to embed PDF ${url}:`, err);
      }
    } else if (ct.startsWith("text/")) {
      try {
        let txt = await (await fetch(url)).text();
        if (txt.length > 8000) {
          txt = txt.slice(0, 8000) + "... [truncated]";
        }
        const ext = name.split(".").pop() ?? "txt";
        blocks.push({
          type: "text",
          text: `\`\`\`${ext}\n${txt}\n\`\`\``,
        });
        seen.add(key);
        logger.debug(`[extractDiscord] Text attachment embedded from ${url}`);
      } catch (err) {
        logger.warn(`[extractDiscord] Failed to embed text ${url}:`, err);
      }
    } else {
      seen.add(key);
      logger.debug(`[extractDiscord] Skipped non-supported attachment: ${url}`);
    }
  }
}
