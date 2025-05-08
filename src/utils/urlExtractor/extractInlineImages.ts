/**
 * @file src/utils/urlExtractor/extractInlineImages.ts
 * @description Scans message content for direct image URLs and inlines or references them.
 * @remarks
 *   - Recognises trusted hosts (e.g. Discord CDN, Tenor, Giphy) and adds URLs directly.
 *   - Inlines untrusted host images as base64 data URIs.
 *   - Honour allowInline flag; skip extraction when disabled.
 *   - Avoids duplicates via seen set.
 *   - Logs progress and warnings via logger.debug and logger.warn.
 */
import { Block } from "@/types";
import { Message } from "discord.js";
import { stripQuery } from "../discordHelpers";
import logger from "../logger";

/**
 * Hosts allowed for direct inline image embedding.
 */
const TRUSTED_IMAGE_HOSTS = [
  "cdn.discordapp.com",
  "media.tenor.com",
  "media.giphy.com",
];

/**
 * Extracts inline images from message text, embedding or inlining as needed.
 *
 * @param message - The incoming Discord.js Message.
 * @param blocks - Array to append image_url Blocks.
 * @param seen - Set of URL keys already included.
 * @param allow - Whether inline image extraction is enabled.
 */
export async function extractInlineImages(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  allow: boolean
): Promise<void> {
  logger.debug("[extractInlineImages] invoked");
  if (!allow) return;

  // Find all image URLs in content
  const matches =
    message.content.match(
      /https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi
    ) || [];

  for (const rawUrl of matches) {
    const key = stripQuery(rawUrl);
    if (seen.has(key)) continue;
    const host = new URL(rawUrl).hostname;
    logger.debug(`[extractInlineImages] Found inline image: ${rawUrl}`);

    if (TRUSTED_IMAGE_HOSTS.includes(host)) {
      // Trusted host: add URL directly
      blocks.push({ type: "image_url", image_url: { url: rawUrl } });
      logger.debug(`[extractInlineImages] Added trusted image: ${rawUrl}`);
    } else {
      // Untrusted: fetch and inline as base64
      try {
        const res = await fetch(rawUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get("content-type") || "";
        const arrayBuf = await res.arrayBuffer();
        const base64 = Buffer.from(arrayBuf).toString("base64");
        blocks.push({
          type: "image_url",
          image_url: { url: `data:${contentType};base64,${base64}` },
        });
        logger.debug(
          `"[extractInlineImages] Inlined untrusted image: ${rawUrl}`
        );
      } catch (err) {
        // Fallback: use raw URL
        blocks.push({ type: "image_url", image_url: { url: rawUrl } });
        logger.warn(
          `[extractInlineImages] Failed to inline ${rawUrl}, using raw URL`,
          err
        );
      }
    }

    seen.add(key);
  }
}
