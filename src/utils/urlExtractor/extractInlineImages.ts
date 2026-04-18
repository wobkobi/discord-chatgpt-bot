/**
 * @file src/utils/urlExtractor/extractInlineImages.ts
 * @description Scans message content for direct image URLs and inlines or references them as Blocks.
 */

import { Block } from "@/types/block.js";
import { stripQuery } from "@/utils/discordHelpers.js";
import logger from "@/utils/logger.js";
import { Message } from "discord.js";

const TRUSTED_IMAGE_HOSTS = ["cdn.discordapp.com", "media.tenor.com", "media.giphy.com"];

/**
 * Extracts inline images from message text, embedding trusted hosts directly and inlining others as base64.
 * @param message - The incoming Discord.js Message.
 * @param blocks - Array to append image_url Blocks.
 * @param seen - Set of URL keys already included.
 * @param allow - Whether inline image extraction is enabled.
 */
export async function extractInlineImages(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  allow: boolean,
): Promise<void> {
  if (!allow) return;

  const matches = message.content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi) || [];

  for (const rawUrl of matches) {
    const key = stripQuery(rawUrl);
    if (seen.has(key)) continue;
    const host = new URL(rawUrl).hostname;

    if (TRUSTED_IMAGE_HOSTS.includes(host)) {
      blocks.push({ type: "image_url", image_url: { url: rawUrl } });
    } else {
      try {
        const res = await fetch(rawUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get("content-type") || "";
        const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
        blocks.push({
          type: "image_url",
          image_url: { url: `data:${contentType};base64,${base64}` },
        });
      } catch (err) {
        blocks.push({ type: "image_url", image_url: { url: rawUrl } });
        logger.warn(`[extractInlineImages] Failed to inline ${rawUrl}, using raw URL`, err);
      }
    }

    seen.add(key);
  }
}
