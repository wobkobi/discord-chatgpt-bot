/**
 * @file src/utils/urlExtractor/extractSocialEmbeds.ts
 * @description Processes social media embeds (Twitter, YouTube, Reddit, Instagram, TikTok) into Blocks.
 */

import { Block } from "@/types/block.js";
import { stripQuery } from "@/utils/discordHelpers.js";
import logger from "@/utils/logger.js";
import { IMAGE_EXT_RE } from "@/utils/urlExtractor/index.js";
import { Message } from "discord.js";
import sanitizeHtml from "sanitize-html";

const PROVIDERS = [
  { name: "twitter", re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/\S+\/status\/\d+/gi },
  { name: "youtube", re: /https?:\/\/(?:youtu\.be\/|www\.youtube\.com\/watch\?v=)\S+/gi },
  { name: "reddit", re: /https?:\/\/(?:www\.)?reddit\.com\/r\/\S+\/comments\/\S+/gi },
  { name: "instagram", re: /https?:\/\/(?:www\.)?(?:instagram|instagr\.am)\/[pr]eels?\/\S+/gi },
  { name: "tiktok", re: /https?:\/\/(?:[\w.-]+\.)?tiktok\.com\/\S+/gi },
];

/**
 * Extracts social media embeds from a Discord message.
 * @param message - The incoming Discord.js Message to inspect.
 * @param blocks - The array to append resulting Blocks (text or image_url).
 * @param skip - A Set of URLs to omit from generic fallback processing.
 * @returns A promise that resolves when all providers have been processed.
 */
export async function extractSocialEmbeds(
  message: Message,
  blocks: Block[],
  skip: Set<string>,
): Promise<void> {
  for (const { name, re } of PROVIDERS) {
    const links = message.content.match(re) || [];
    for (const link of links) {
      skip.add(stripQuery(link));
      if (IMAGE_EXT_RE.test(link)) {
        blocks.push({ type: "image_url", image_url: { url: link } });
      } else if (name === "twitter") {
        await handleTwitter(link, blocks);
      } else if (name === "youtube") {
        await handleYouTube(link, blocks);
      } else {
        blocks.push({ type: "text", text: link });
      }
    }
  }
}

/**
 * Handles Twitter oEmbed extraction: images and tweet text.
 * @param link - The URL of the Tweet to fetch oEmbed data for.
 * @param blocks - The array of Blocks to append extracted images or text.
 * @returns A promise that resolves once processing is complete.
 */
async function handleTwitter(link: string, blocks: Block[]): Promise<void> {
  try {
    const res = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(link)}`);
    const data = (await res.json()) as { html?: string };
    const html = data.html || "";

    const urls = html.match(/https?:\/\/[^"\s<]+/gi) || [];
    for (const u of urls) {
      if (IMAGE_EXT_RE.test(u)) blocks.push({ type: "image_url", image_url: { url: u } });
    }

    const match = html.match(/<p[^>]*>(.*?)<\/p>/i);
    const text = match?.[1]
      ? sanitizeHtml(match[1], { allowedTags: [], allowedAttributes: {} }).trim()
      : link;
    blocks.push({ type: "text", text });
  } catch (err) {
    logger.warn(`[handleTwitter] oEmbed failed for ${link}`, err);
  }
}

/**
 * Handles YouTube oEmbed extraction: thumbnail image and video title.
 * @param link - The URL of the YouTube video to fetch oEmbed data for.
 * @param blocks - The array of Blocks to append thumbnail and title text.
 * @returns A promise that resolves once processing is complete.
 */
async function handleYouTube(link: string, blocks: Block[]): Promise<void> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(link)}`);
    const data = (await res.json()) as { title?: string; thumbnail_url?: string };

    if (data.thumbnail_url && IMAGE_EXT_RE.test(data.thumbnail_url)) {
      blocks.push({ type: "image_url", image_url: { url: data.thumbnail_url } });
    }
    blocks.push({ type: "text", text: data.title?.trim() || link });
  } catch (err) {
    logger.warn(`[handleYouTube] oEmbed failed for ${link}`, err);
  }
}
