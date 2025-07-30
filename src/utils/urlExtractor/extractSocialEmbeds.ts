/**
 * @file src/utils/urlExtractor/extractSocialEmbeds.ts
 * @description Processes social media embeds (Twitter, YouTube, Reddit, Instagram, TikTok) into Blocks.
 *
 *   - Detects provider links via regex patterns.
 *   - Twitter: oEmbed for images and text extraction.
 *   - YouTube: oEmbed for thumbnail and title.
 *   - Reddit, Instagram, TikTok: falls back to plain URL text.
 *   - Skips duplicate or unwanted URLs via skip set.
 *   - Logs detailed debug info and warnings.
 */
import { Block } from "@/types/block.js";
import { Message } from "discord.js";
import sanitizeHtml from "sanitize-html";
import { stripQuery } from "../discordHelpers.js";
import logger from "../logger.js";
import { IMAGE_EXT_RE } from "./index.js";

// Regex patterns for supported providers
const PROVIDERS = [
  {
    name: "twitter",
    re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/\S+\/status\/\d+/gi,
  },
  {
    name: "youtube",
    re: /https?:\/\/(?:youtu\.be\/|www\.youtube\.com\/watch\?v=)\S+/gi,
  },
  {
    name: "reddit",
    re: /https?:\/\/(?:www\.)?reddit\.com\/r\/\S+\/comments\/\S+/gi,
  },
  {
    name: "instagram",
    re: /https?:\/\/(?:www\.)?(?:instagram|instagr\.am)\/[pr]eels?\/\S+/gi,
  },
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
  skip: Set<string>
): Promise<void> {
  logger.debug("[extractSocialEmbeds] invoked");

  for (const { name, re } of PROVIDERS) {
    const links = message.content.match(re) || [];
    for (const link of links) {
      const clean = stripQuery(link);
      skip.add(clean);
      logger.debug(`[extractSocialEmbeds] Processing ${name} link: ${link}`);

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
  logger.debug(`[handleTwitter] invoked for ${link}`);
  try {
    const res = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(link)}`
    );
    const data = (await res.json()) as { html?: string };
    const html = data.html || "";

    // Extract image URLs
    const urls = html.match(/https?:\/\/[^"\s<]+/gi) || [];
    for (const u of urls) {
      if (IMAGE_EXT_RE.test(u)) {
        blocks.push({ type: "image_url", image_url: { url: u } });
        logger.debug(`[handleTwitter] Added image: ${u}`);
      }
    }

    // Extract tweet text
    const match = html.match(/<p[^>]*>(.*?)<\/p>/i);
    let text = link;
    if (match?.[1]) {
      text = sanitizeHtml(match[1], {
        allowedTags: [],
        allowedAttributes: {},
      }).trim();
    }
    blocks.push({ type: "text", text });
    logger.debug(`[handleTwitter] Added text: ${text}`);
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
  logger.debug(`[handleYouTube] invoked for ${link}`);
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(link)}`
    );
    const data = (await res.json()) as {
      title?: string;
      thumbnail_url?: string;
    };

    if (data.thumbnail_url && IMAGE_EXT_RE.test(data.thumbnail_url)) {
      blocks.push({
        type: "image_url",
        image_url: { url: data.thumbnail_url },
      });
      logger.debug(`[handleYouTube] Added thumbnail: ${data.thumbnail_url}`);
    }

    const text = data.title?.trim() || link;
    blocks.push({ type: "text", text });
    logger.debug(`[handleYouTube] Added title: ${text}`);
  } catch (err) {
    logger.warn(`[handleYouTube] oEmbed failed for ${link}`, err);
  }
}
