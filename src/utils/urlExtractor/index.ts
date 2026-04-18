/**
 * @file src/utils/urlExtractor/index.ts
 * @description Parses and normalises Discord message contents into structured ChatGPT Blocks.
 */

import { Block } from "@/types/block.js";
import { stripQuery } from "@/utils/discordHelpers.js";
import { getOptional } from "@/utils/env.js";
import { extractAttachments, extractStickers } from "@/utils/urlExtractor/extractDiscord.js";
import { extractGiphyGifs, extractTenorGifs } from "@/utils/urlExtractor/extractGifs.js";
import { extractInlineImages } from "@/utils/urlExtractor/extractInlineImages.js";
import { extractSocialEmbeds } from "@/utils/urlExtractor/extractSocialEmbeds.js";
import { Message } from "discord.js";

/** Recognises image file extensions for inline detection. */
export const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(?:\?|$)/i;

/**
 * Extracts structured content Blocks and leftover URLs from a Discord message.
 * @param message - The incoming Discord.js Message object.
 * @returns An object containing `blocks` (ChatGPT-compatible Blocks) and `genericUrls` (unprocessed URLs).
 */
export async function extractInputs(
  message: Message,
): Promise<{ blocks: Block[]; genericUrls: string[] }> {
  const tenorKey = getOptional("TENOR_API_KEY");
  const giphyKey = getOptional("GIPHY_API_KEY");
  const useFT = getOptional("USE_FINE_TUNED_MODEL") === "true";
  const ftVision = getOptional("FINE_TUNED_SUPPORTS_VISION") === "true";
  const allowInline = !useFT || ftVision;

  const blocks: Block[] = [];
  const seenImages = new Set<string>();
  const skipEmbeds = new Set<string>();

  extractStickers(message, blocks, seenImages);
  await extractAttachments(message, blocks, seenImages);
  await extractInlineImages(message, blocks, seenImages, allowInline);
  await extractTenorGifs(message, blocks, seenImages, skipEmbeds, tenorKey, allowInline);
  await extractGiphyGifs(message, blocks, seenImages, skipEmbeds, giphyKey, allowInline);
  await extractSocialEmbeds(message, blocks, skipEmbeds);

  const genericUrls = collectGenericUrls(message.content, seenImages, skipEmbeds);
  return { blocks, genericUrls };
}

/**
 * Filters out URLs that have already been processed as Blocks or should be skipped.
 * @param content - Raw message content string.
 * @param seen - Set of URLs already produced as Blocks.
 * @param skip - Set of URLs to deliberately omit.
 * @returns Array of leftover URL strings.
 */
function collectGenericUrls(content: string, seen: Set<string>, skip: Set<string>): string[] {
  const all = content.match(/https?:\/\/\S+/gi) || [];
  return all.filter((url) => !seen.has(stripQuery(url)) && !skip.has(stripQuery(url)));
}
