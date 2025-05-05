/**
 * @file src/utils/urlExtractor.ts
 * @description Parse and normalise various Discord message contents into structured ChatGPT Blocks,
 *              including stickers, attachments, inline images, GIFs, and social media oEmbeds.
 * @remarks
 *   Handles:
 *     - Discord stickers: captures sticker image URLs
 *     - Attachments: images, PDFs, text attachments, and other binaries
 *     - Inline images: trusted hosts or inlined via base64
 *     - Tenor & Giphy GIFs: resolved via API or SDK
 *     - Social media embeds: Twitter, YouTube, Reddit, Instagram, TikTok
 *       • Extracts image links in embed HTML and embeds them as images
 *       • Extracts tweet text or video titles
 *     - Generic URLs fallback
 */
import { Block } from "@/types/index.js";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { Message } from "discord.js";
import fetch from "node-fetch";
import { stripQuery } from "./discordHelpers.js";
import { getRequired } from "./env.js";
import logger from "./logger.js";

// Constants
const TRUSTED_IMAGE_HOSTS = [
  "cdn.discordapp.com",
  "media.tenor.com",
  "media.giphy.com",
];
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(?:\?|$)/i;

// Interfaces for Tenor API response
interface TenorPost {
  media_formats: { gif?: { url: string } };
}
interface TenorPostsResponse {
  results: TenorPost[];
}

/**
 * Parses a Discord message and extracts structured Block inputs and leftover URLs.
 *
 * @param message - The Discord.js Message object to parse.
 * @returns An object containing:
 *   - blocks: Array of ChatGPT Block objects representing parsed content.
 *   - genericUrls: Array of leftover URLs not converted to blocks.
 */
export async function extractInputs(
  message: Message
): Promise<{ blocks: Block[]; genericUrls: string[] }> {
  logger.debug("extractInputs: Starting extraction");
  const tenorKey = getRequired("TENOR_API_KEY");
  const giphyKey = getRequired("GIPHY_API_KEY");
  const useFine = getRequired("USE_FINE_TUNED_MODEL") === "true";

  const blocks: Block[] = [];
  const seenImages = new Set<string>();
  const skipPages = new Set<string>();
  const allowInline = !useFine;

  extractStickers(message, blocks, seenImages);
  await extractAttachments(message, blocks, seenImages);
  await extractInlineImages(message, blocks, seenImages, allowInline);
  await extractTenorGifs(
    message,
    blocks,
    seenImages,
    skipPages,
    tenorKey,
    allowInline
  );
  await extractGiphyGifs(
    message,
    blocks,
    seenImages,
    skipPages,
    giphyKey,
    allowInline
  );
  await extractEmbeds(message, blocks, skipPages);

  const genericUrls = collectGenericUrls(
    message.content,
    seenImages,
    skipPages
  );
  return { blocks, genericUrls };
}

/**
 * Captures Discord sticker images as image_url blocks.
 *
 * @param message - Discord.js Message containing stickers.
 * @param blocks - Array to append Block objects to.
 * @param seen - Set of image URLs already processed.
 */
function extractStickers(
  message: Message,
  blocks: Block[],
  seen: Set<string>
): void {
  message.stickers?.forEach((sticker) => {
    const url = sticker.url;
    blocks.push({ type: "image_url", image_url: { url } });
    seen.add(stripQuery(url));
  });
}

/**
 * Processes attachments in a Discord message: images, PDFs, text files, other binaries.
 *
 * @param message - Discord.js Message containing attachments.
 * @param blocks - Array to append Block objects to.
 * @param seen - Set of URLs already processed.
 */
async function extractAttachments(
  message: Message,
  blocks: Block[],
  seen: Set<string>
): Promise<void> {
  for (const att of message.attachments.values()) {
    const url = att.url;
    const key = stripQuery(url);
    const ct = att.contentType || "application/octet-stream";
    const name = att.name || "file";

    if (ct.startsWith("image/")) {
      blocks.push({ type: "image_url", image_url: { url } });
      seen.add(key);
    } else if (ct === "application/pdf") {
      try {
        const data = await (await fetch(url)).arrayBuffer();
        const b64 = Buffer.from(data).toString("base64");
        blocks.push({
          type: "file",
          file: { filename: name, file_data: `data:${ct};base64,${b64}` },
        });
        seen.add(key);
      } catch (e) {
        logger.warn("PDF fetch failed", e);
      }
    } else if (ct.startsWith("text/")) {
      try {
        let txt = await (await fetch(url)).text();
        if (txt.length > 8000) txt = txt.slice(0, 8000) + "... [truncated]";
        const ext = name.split(".").pop() || "txt";
        blocks.push({ type: "text", text: `\`\`\`${ext}\n${txt}\n\`\`\`` });
      } catch (e) {
        logger.warn("Text fetch failed", e);
      }
    } else {
      seen.add(key);
    }
  }
}

/**
 * Extracts inline image URLs from message content and inlines untrusted images as base64.
 *
 * @param message - Discord.js Message to scan for inline images.
 * @param blocks - Array to append image_url blocks to.
 * @param seen - Set of processed image URLs.
 * @param allow - Flag to enable inline image extraction.
 */
async function extractInlineImages(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  allow: boolean
): Promise<void> {
  if (!allow) return;
  const matches =
    message.content.match(
      /https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi
    ) || [];
  for (const raw of matches) {
    const key = stripQuery(raw);
    if (seen.has(key)) continue;
    const host = new URL(raw).hostname;
    if (TRUSTED_IMAGE_HOSTS.includes(host)) {
      blocks.push({ type: "image_url", image_url: { url: raw } });
    } else {
      try {
        const res = await fetch(raw);
        if (res.ok) {
          const c = res.headers.get("content-type") || "";
          const data = await res.arrayBuffer();
          const b64 = Buffer.from(data).toString("base64");
          blocks.push({
            type: "image_url",
            image_url: { url: `data:${c};base64,${b64}` },
          });
        } else throw res.status;
      } catch {
        blocks.push({ type: "image_url", image_url: { url: raw } });
      }
    }
    seen.add(key);
  }
}

/**
 * Fetches and embeds Tenor GIFs by ID from message content.
 *
 * @param message - Discord.js Message to scan for Tenor links.
 * @param blocks - Array to append image_url blocks to.
 * @param seen - Set to track embedded image URLs.
 * @param skip - Set to track embed URLs to skip in generic URLs.
 * @param apiKey - Tenor API key.
 * @param allow - Flag to enable GIF extraction.
 */
async function extractTenorGifs(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  skip: Set<string>,
  apiKey: string,
  allow: boolean
): Promise<void> {
  if (!apiKey || !allow) return;
  const links =
    message.content.match(/https?:\/\/tenor\.com\/view\/\S+/gi) || [];
  for (const link of links) {
    skip.add(stripQuery(link));
    const id = link.match(/-(\d+)(?:$|\?)/)?.[1];
    if (!id) continue;
    try {
      const json = (await (
        await fetch(
          `https://tenor.googleapis.com/v2/posts?ids=${id}&key=${apiKey}`
        )
      ).json()) as TenorPostsResponse;
      const url = json.results[0]?.media_formats.gif?.url;
      if (url) {
        blocks.push({ type: "image_url", image_url: { url } });
        seen.add(stripQuery(url));
      }
    } catch (e) {
      logger.error("Tenor error", e);
    }
  }
}

/**
 * Fetches and embeds Giphy GIFs via SDK based on links in message content.
 *
 * @param message - Discord.js Message to scan for Giphy links.
 * @param blocks - Array to append image_url blocks to.
 * @param seen - Set of processed image URLs.
 * @param skip - Set to track embed URLs to skip in generic URLs.
 * @param apiKey - Giphy API key.
 * @param allow - Flag to enable GIF extraction.
 */
async function extractGiphyGifs(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  skip: Set<string>,
  apiKey: string,
  allow: boolean
): Promise<void> {
  if (!apiKey || !allow) return;
  const gf = new GiphyFetch(apiKey);
  const links =
    message.content.match(/https?:\/\/\S+\.giphy\.com\/gifs\/\S+/gi) || [];
  for (const link of links) {
    skip.add(stripQuery(link));
    const id = link.split("-").pop();
    if (!id) continue;
    try {
      const { data } = await gf.gif(id);
      const url = data.images.original.url;
      if (IMAGE_EXT_RE.test(url)) {
        blocks.push({ type: "image_url", image_url: { url } });
        seen.add(stripQuery(url));
      }
    } catch (e) {
      logger.error("Giphy error", e);
    }
  }
}

/**
 * Processes social media embed links, embedding images or extracting text.
 *
 * @param message - Discord.js Message to scan for embed links.
 * @param blocks - Array to append Block objects to.
 * @param skip - Set to track embed URLs to skip in generic URLs.
 */
async function extractEmbeds(
  message: Message,
  blocks: Block[],
  skip: Set<string>
): Promise<void> {
  const providers = [
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
  for (const { name, re } of providers) {
    for (const link of message.content.match(re) || []) {
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
 * Handles Twitter oEmbed HTML, extracting image and text from embed.
 *
 * @param link - Twitter status URL.
 * @param blocks - Array to append Block objects to.
 */
async function handleTwitter(link: string, blocks: Block[]): Promise<void> {
  try {
    const res = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(link)}`
    );
    const data = (await res.json()) as { html?: string };
    const html = data.html ?? "";
    // Extract URLs from embed HTML
    const urls = html.match(/https?:\/\/[^"\s<]+/gi) || [];
    for (const u of urls) {
      if (IMAGE_EXT_RE.test(u)) {
        blocks.push({ type: "image_url", image_url: { url: u } });
      }
    }
    // Extract tweet text
    const textMatch = html
      .match(/<p[^>]*>(.*?)<\/p>/i)?.[1]
      .replace(/<[^>]+>/g, "")
      .trim();
    const text = textMatch && textMatch.length > 0 ? textMatch : link;
    blocks.push({ type: "text", text });
  } catch (e) {
    logger.warn("Twitter oEmbed failed", e);
  }
}

/**
 * Handles YouTube oEmbed, extracting thumbnail and video title.
 *
 * @param link - YouTube video URL.
 * @param blocks - Array to append Block objects to.
 */
async function handleYouTube(link: string, blocks: Block[]): Promise<void> {
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
    }
    blocks.push({ type: "text", text: data.title?.trim() || link });
  } catch (e) {
    logger.warn("YouTube oEmbed failed", e);
  }
}

/**
 * Collects leftover URLs not already processed as embeds or images.
 *
 * @param content - Original message content string.
 * @param seen - Set of URLs already processed as images or embeds.
 * @param skip - Set of URLs to skip (oEmbed source URLs).
 * @returns Array of generic URL strings.
 */
function collectGenericUrls(
  content: string,
  seen: Set<string>,
  skip: Set<string>
): string[] {
  const all = content.match(/https?:\/\/\S+/gi) || [];
  return all.filter(
    (url) => !seen.has(stripQuery(url)) && !skip.has(stripQuery(url))
  );
}
