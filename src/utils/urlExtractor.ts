/**
 * @file src/utils/urlExtractor.ts
 * @description Parse and normalise various Discord message contents into structured ChatGPT Blocks,
 *   including stickers, attachments, inline images, GIFs, and social media oEmbeds.
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
 *   Provides detailed debug logs via logger.debug at each processing step.
 */
import { Block } from "@/types/index.js";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { Message } from "discord.js";
import fetch from "node-fetch";
import { stripQuery } from "./discordHelpers.js";
import sanitizeHtml from "sanitize-html";
import { getRequired } from "./env.js";
import logger from "./logger.js";

// Recognised hosts for direct inline images
const TRUSTED_IMAGE_HOSTS = [
  "cdn.discordapp.com",
  "media.tenor.com",
  "media.giphy.com",
];
// File extension regex for image formats
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(?:\?|$)/i;

// Types for Tenor API response
interface TenorPost {
  media_formats: { gif?: { url: string } };
}
interface TenorPostsResponse {
  results: TenorPost[];
}

logger.debug("[urlExtractor] Module initialised");

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
  logger.debug("[urlExtractor] extractInputs invoked");
  const tenorKey = getRequired("TENOR_API_KEY");
  const giphyKey = getRequired("GIPHY_API_KEY");
  const allowInline = getRequired("USE_FINE_TUNED_MODEL") !== "true";

  const blocks: Block[] = [];
  const seenImages = new Set<string>();
  const skipEmbeds = new Set<string>();

  extractStickers(message, blocks, seenImages);
  await extractAttachments(message, blocks, seenImages);
  await extractInlineImages(message, blocks, seenImages, allowInline);
  await extractTenorGifs(
    message,
    blocks,
    seenImages,
    skipEmbeds,
    tenorKey,
    allowInline
  );
  await extractGiphyGifs(
    message,
    blocks,
    seenImages,
    skipEmbeds,
    giphyKey,
    allowInline
  );
  await extractSocialEmbeds(message, blocks, skipEmbeds);

  const genericUrls = collectGenericUrls(
    message.content,
    seenImages,
    skipEmbeds
  );
  logger.debug(
    `[urlExtractor] extractInputs completed: blocks=${blocks.length}, genericUrls=${genericUrls.length}`
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
  logger.debug("[urlExtractor] extractStickers invoked");
  for (const sticker of message.stickers.values()) {
    const url = sticker.url;
    blocks.push({ type: "image_url", image_url: { url } });
    seen.add(stripQuery(url));
    logger.debug(`[urlExtractor] Sticker URL added: ${url}`);
  }
}

/**
 * Processes attachments: images, PDFs, text, and other file types.
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
  logger.debug("[urlExtractor] extractAttachments invoked");
  for (const att of message.attachments.values()) {
    const url = att.url;
    const key = stripQuery(url);
    const ct = att.contentType || "application/octet-stream";
    const name = att.name || "file";
    logger.debug(`[urlExtractor] Attachment detected: ${url} (type=${ct})`);

    if (ct.startsWith("image/")) {
      blocks.push({ type: "image_url", image_url: { url } });
      seen.add(key);
      logger.debug(`[urlExtractor] Image attachment added: ${url}`);
    } else if (ct === "application/pdf") {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        blocks.push({
          type: "file",
          file: { filename: name, file_data: `data:${ct};base64,${b64}` },
        });
        seen.add(key);
        logger.debug(`[urlExtractor] PDF embedded: ${url}`);
      } catch (err) {
        logger.warn(`[urlExtractor] PDF fetch failed for ${url}`, err);
      }
    } else if (ct.startsWith("text/")) {
      try {
        let txt = await (await fetch(url)).text();
        if (txt.length > 8000) txt = txt.slice(0, 8000) + "... [truncated]";
        const ext = name.split(".").pop() || "txt";
        blocks.push({ type: "text", text: `\`\`\`${ext}\n${txt}\n\`\`\`` });
        seen.add(key);
        logger.debug(`[urlExtractor] Text attachment embedded from ${url}`);
      } catch (err) {
        logger.warn(`[urlExtractor] Text fetch failed for ${url}`, err);
      }
    } else {
      seen.add(key);
      logger.debug(`[urlExtractor] Skipped attachment: ${url}`);
    }
  }
}

/**
 * Extracts inline images, inlining base64 for untrusted hosts.
 *
 * @param message - Discord.js Message to scan.
 * @param blocks - Array to append image_url blocks to.
 * @param seen - Set of processed image URLs.
 * @param allow - Whether inline extraction is permitted.
 */
async function extractInlineImages(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  allow: boolean
): Promise<void> {
  logger.debug("[urlExtractor] extractInlineImages invoked");
  if (!allow) return;
  const matches =
    message.content.match(
      /https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi
    ) || [];
  for (const raw of matches) {
    const key = stripQuery(raw);
    if (seen.has(key)) continue;
    const host = new URL(raw).hostname;
    logger.debug(`[urlExtractor] Inline image found: ${raw}`);
    if (TRUSTED_IMAGE_HOSTS.includes(host)) {
      blocks.push({ type: "image_url", image_url: { url: raw } });
      logger.debug(`[urlExtractor] Trusted inline image added: ${raw}`);
    } else {
      try {
        const res = await fetch(raw);
        if (res.ok) {
          const ct = res.headers.get("content-type") || "";
          const buf = await res.arrayBuffer();
          const b64 = Buffer.from(buf).toString("base64");
          blocks.push({
            type: "image_url",
            image_url: { url: `data:${ct};base64,${b64}` },
          });
          logger.debug(
            `[urlExtractor] Untrusted image inlined as base64: ${raw}`
          );
        } else throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        blocks.push({ type: "image_url", image_url: { url: raw } });
        logger.warn(
          `[urlExtractor] Failed to inline image ${raw}, using raw URL`,
          err
        );
      }
    }
    seen.add(key);
  }
}

/**
 * Fetches and embeds Tenor GIFs by ID.
 */
async function extractTenorGifs(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  skip: Set<string>,
  apiKey: string,
  allow: boolean
): Promise<void> {
  logger.debug("[urlExtractor] extractTenorGifs invoked");
  if (!apiKey || !allow) return;
  const links =
    message.content.match(/https?:\/\/tenor\.com\/view\/\S+/gi) || [];
  for (const link of links) {
    skip.add(stripQuery(link));
    const id = link.match(/-(\d+)(?:$|\?)/)?.[1];
    if (!id) continue;
    try {
      const res = await fetch(
        `https://tenor.googleapis.com/v2/posts?ids=${id}&key=${apiKey}`
      );
      const json = (await res.json()) as TenorPostsResponse;
      const url = json.results[0]?.media_formats.gif?.url;
      if (url) {
        blocks.push({ type: "image_url", image_url: { url } });
        seen.add(stripQuery(url));
        logger.debug(`[urlExtractor] Tenor GIF added: ${url}`);
      }
    } catch (err) {
      logger.error(`[urlExtractor] Tenor error for link ${link}`, err);
    }
  }
}

/**
 * Fetches and embeds Giphy GIFs by ID.
 */
async function extractGiphyGifs(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  skip: Set<string>,
  apiKey: string,
  allow: boolean
): Promise<void> {
  logger.debug("[urlExtractor] extractGiphyGifs invoked");
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
        logger.debug(`[urlExtractor] Giphy GIF added: ${url}`);
      }
    } catch (err) {
      logger.error(`[urlExtractor] Giphy error for link ${link}`, err);
    }
  }
}

/**
 * Processes social media embeds for Twitter, YouTube, Reddit, Instagram, and TikTok.
 */
async function extractSocialEmbeds(
  message: Message,
  blocks: Block[],
  skip: Set<string>
): Promise<void> {
  logger.debug("[urlExtractor] extractSocialEmbeds invoked");
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
    const links = message.content.match(re) || [];
    for (const link of links) {
      skip.add(stripQuery(link));
      logger.debug(`[urlExtractor] Processing ${name} embed: ${link}`);
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
 * Handles Twitter oEmbed, extracting images and tweet text.
 */
async function handleTwitter(link: string, blocks: Block[]): Promise<void> {
  logger.debug(`[urlExtractor] handleTwitter invoked for ${link}`);
  try {
    const res = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(link)}`
    );
    const data = (await res.json()) as { html?: string };
    const html = data.html || "";
    const urls = html.match(/https?:\/\/[^"\s<]+/gi) || [];
    for (const u of urls) {
      if (IMAGE_EXT_RE.test(u)) {
        blocks.push({ type: "image_url", image_url: { url: u } });
        logger.debug(`[urlExtractor] Twitter image added: ${u}`);
      }
    }
    const text =
      html
        .match(/<p[^>]*>(.*?)<\/p>/i)?.[1]
        ?.let((htmlContent) => sanitizeHtml(htmlContent, { allowedTags: [], allowedAttributes: {} }))
        .trim() || link;
    blocks.push({ type: "text", text });
    logger.debug(`[urlExtractor] Tweet text added: ${text}`);
  } catch (err) {
    logger.warn(`[urlExtractor] Twitter oEmbed failed for ${link}`, err);
  }
}

/**
 * Handles YouTube oEmbed, extracting thumbnail and title.
 */
async function handleYouTube(link: string, blocks: Block[]): Promise<void> {
  logger.debug(`[urlExtractor] handleYouTube invoked for ${link}`);
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
      logger.debug(
        `[urlExtractor] YouTube thumbnail added: ${data.thumbnail_url}`
      );
    }
    const text = data.title?.trim() || link;
    blocks.push({ type: "text", text });
    logger.debug(`[urlExtractor] Video title added: ${text}`);
  } catch (err) {
    logger.warn(`[urlExtractor] YouTube oEmbed failed for ${link}`, err);
  }
}

/**
 * Collects leftover URLs not already processed as images or embeds.
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
  logger.debug("[urlExtractor] collectGenericUrls invoked");
  const all = content.match(/https?:\/\/\S+/gi) || [];
  const generic = all.filter(
    (url) => !seen.has(stripQuery(url)) && !skip.has(stripQuery(url))
  );
  logger.debug(
    `[urlExtractor] collectGenericUrls found ${generic.length} URLs`
  );
  return generic;
}
