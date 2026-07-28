// src/utils/urlExtractor/extractDiscord.ts
/**
 * @description Captures Discord stickers and attachments, converting them into ChatGPT Blocks.
 */

import { Block } from "@/types/block.js";
import { stripQuery } from "@/utils/discordHelpers.js";
import logger from "@/utils/logger.js";
import { Message } from "discord.js";
import fetch from "node-fetch";

/** Largest PDF attachment the bot will download and embed as base64. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** Largest text attachment the bot will download (truncated further after reading). */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * Captures Discord sticker images as image_url blocks.
 * @param message - The incoming Discord.js Message.
 * @param blocks - Array to append Block objects.
 * @param seen - Set of image URL keys already processed.
 */
export function extractStickers(message: Message, blocks: Block[], seen: Set<string>): void {
  for (const sticker of message.stickers.values()) {
    blocks.push({ type: "image_url", image_url: { url: sticker.url } });
    seen.add(stripQuery(sticker.url));
  }
}

/**
 * Processes message attachments, embedding or skipping based on type:
 * images → image_url blocks; PDFs → base64 file blocks; text → code blocks (truncated at 8000 chars).
 * @param message - The incoming Discord.js Message.
 * @param blocks - Array to append Block objects.
 * @param seen - Set of URL keys already processed.
 */
export async function extractAttachments(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
): Promise<void> {
  for (const att of message.attachments.values()) {
    const url = att.url;
    const key = stripQuery(url);
    const ct = att.contentType ?? "application/octet-stream";
    const name = att.name ?? "file";

    if (ct.startsWith("image/")) {
      blocks.push({ type: "image_url", image_url: { url } });
      seen.add(key);
    } else if (ct === "application/pdf") {
      // Discord reports attachment size up front; skip before downloading, not after
      if (att.size > MAX_PDF_BYTES) {
        logger.warn(`[extractDiscord] Skipping oversized PDF ${name} (${att.size} bytes)`);
        seen.add(key);
        continue;
      }
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        blocks.push({
          type: "file",
          file: { filename: name, file_data: `data:${ct};base64,${b64}` },
        });
        seen.add(key);
      } catch (err) {
        logger.warn(`[extractDiscord] Failed to embed PDF ${url}:`, err);
      }
    } else if (ct.startsWith("text/")) {
      if (att.size > MAX_TEXT_BYTES) {
        logger.warn(
          `[extractDiscord] Skipping oversized text attachment ${name} (${att.size} bytes)`,
        );
        seen.add(key);
        continue;
      }
      try {
        let txt = await (await fetch(url)).text();
        if (txt.length > 8000) txt = txt.slice(0, 8000) + "... [truncated]";
        const ext = name.split(".").pop() ?? "txt";
        blocks.push({ type: "text", text: `\`\`\`${ext}\n${txt}\n\`\`\`` });
        seen.add(key);
      } catch (err) {
        logger.warn(`[extractDiscord] Failed to embed text ${url}:`, err);
      }
    } else {
      seen.add(key);
    }
  }
}
