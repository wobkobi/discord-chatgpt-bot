/**
 * @file src/utils/urlExtractor/index.ts
 * @description Parses and normalises various Discord message contents into structured ChatGPT Blocks,
 *   including stickers, attachments, inline images, GIFs, and social media embeds.
 *
 *   Handles stickers, attachments, inline/base64 images, Tenor and Giphy GIFs, social media embeds,
 *   and collates generic URLs. Detailed debug logging via logger.debug on each step.
 */
import { Block } from "@/types";
import { Message } from "discord.js";
import { stripQuery } from "../discordHelpers.js";
import { getOptional, getRequired } from "../env.js";
import logger from "../logger.js";
import { extractAttachments, extractStickers } from "./extractDiscord.js";
import { extractGiphyGifs, extractTenorGifs } from "./extractGifs.js";
import { extractInlineImages } from "./extractInlineImages.js";
import { extractSocialEmbeds } from "./extractSocialEmbeds.js";

/**
 * Recognises image file extensions for inline detection.
 */
export const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(?:\?|$)/i;

/**
 * Extracts structured content Blocks and leftover URLs from a Discord message.
 * @param message - The incoming Discord.js Message object.
 * @returns An object containing:
 *   - blocks: Array of ChatGPT-compatible content Blocks.
 *   - genericUrls: Array of URLs not converted to Blocks.
 */
export async function extractInputs(
  message: Message
): Promise<{ blocks: Block[]; genericUrls: string[] }> {
  logger.debug("[urlExtractor] extractInputs invoked");

  const tenorKey = getOptional("TENOR_API_KEY");
  const giphyKey = getOptional("GIPHY_API_KEY");
  const allowInline = getRequired("USE_FINE_TUNED_MODEL") !== "true";

  const blocks: Block[] = [];
  const seenImages = new Set<string>();
  const skipEmbeds = new Set<string>();

  // Capture sticker graphics
  extractStickers(message, blocks, seenImages);

  // Process file attachments (images, PDFs, text)
  await extractAttachments(message, blocks, seenImages);

  // Inline images (base64 or direct URLs)
  await extractInlineImages(message, blocks, seenImages, allowInline);

  // Tenor GIF extraction
  await extractTenorGifs(
    message,
    blocks,
    seenImages,
    skipEmbeds,
    tenorKey,
    allowInline
  );

  // Giphy GIF extraction
  await extractGiphyGifs(
    message,
    blocks,
    seenImages,
    skipEmbeds,
    giphyKey,
    allowInline
  );

  // Social media embeds (Twitter, YouTube, etc.)
  await extractSocialEmbeds(message, blocks, skipEmbeds);

  // Collate any remaining URLs
  const genericUrls = collectGenericUrls(
    message.content,
    seenImages,
    skipEmbeds
  );

  logger.debug(
    `[urlExtractor] Completed: blocks=${blocks.length}, genericUrls=${genericUrls.length}`
  );
  return { blocks, genericUrls };
}

/**
 * Filters out URLs that have already been processed as Blocks or should be skipped.
 * @param content - Raw message content string.
 * @param seen - Set of URLs already produced as Blocks.
 * @param skip - Set of URLs to deliberately omit (e.g. embed source links).
 * @returns Array of leftover URL strings.
 */
function collectGenericUrls(
  content: string,
  seen: Set<string>,
  skip: Set<string>
): string[] {
  logger.debug("[urlExtractor] collectGenericUrls invoked");

  // Match all http(s) links
  const all = content.match(/https?:\/\/\S+/gi) || [];

  // Exclude already handled or skipped URLs
  const generic = all.filter(
    (url) => !seen.has(stripQuery(url)) && !skip.has(stripQuery(url))
  );

  logger.debug(
    `[urlExtractor] collectGenericUrls found ${generic.length} URLs`
  );
  return generic;
}
