/**
 * @file src/utils/urlExtractor.ts
 * @description Extracts and normalises attachments and inline media into ChatGPT Block inputs
 *   (text, image_url, file for PDFs), plus collects remaining "generic" links from a Discord message.
 * @remarks
 *   Supports Discord attachments, inline CDN URLs, image extensions, Tenor GIFs, Giphy links, and other file types.
 */

import { Block } from "@/types/index.js";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { Message } from "discord.js";
import fetch from "node-fetch";
import { stripQuery } from "./discordHelpers.js";
import { getRequired } from "./env.js";
import logger from "./logger.js";

interface TenorMediaFormats {
  /** GIF format with URL to the media */
  gif?: { url: string };
}

interface TenorPost {
  /** Media formats available in the Tenor post */
  media_formats: TenorMediaFormats;
}

interface TenorPostsResponse {
  /** Array of returned Tenor posts */
  results: TenorPost[];
}

/**
 * Determine if a URL is hosted on a trusted image host (Discord CDN, Tenor, Giphy).
 *
 * @param url - The URL to check.
 * @returns True if the host is trusted for direct image linking.
 */
function isTrustedImageHost(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const trustedHosts = [
      "cdn.discordapp.com",
      "media.tenor.com",
      "media.giphy.com"
    ];
    return trustedHosts.includes(parsedUrl.host);
  } catch (e) {
    logger.warn(`Invalid URL provided: ${url}`);
    return false;
  }
}

/**
 * Extracts attachment and inline media blocks and generic URLs from a Discord message.
 *
 * @param message - The Discord message to process.
 * @returns An object containing:
 *   - blocks: Array of multimodal Blocks (text, image_url, file).
 *   - genericUrls: Array of remaining link URLs as strings.
 */
export async function extractInputs(
  message: Message
): Promise<{ blocks: Block[]; genericUrls: string[] }> {
  const tenorApiKey = getRequired("process.TENOR_API_KEY");
  const giphyApiKey = getRequired("GIPHY_API_KEY");

  const blocks: Block[] = [];
  const seenImages = new Set<string>();
  const skipPages = new Set<string>();

  // 1) Process Discord attachments
  for (const att of message.attachments.values()) {
    const url = att.url;
    const bare = stripQuery(url);
    const name = att.name || "file";
    const ct = att.contentType || "application/octet-stream";

    if (ct.startsWith("image/")) {
      blocks.push({ type: "image_url", image_url: { url } });
      seenImages.add(bare);
    } else if (ct.startsWith("text/")) {
      try {
        const res = await fetch(url);
        const txt = await res.text();
        const ext = name.split(".").pop() || "txt";
        blocks.push({ type: "text", text: `\`\`\`${ext}\n${txt}\n\`\`\`` });
      } catch (e) {
        logger.warn("Failed to fetch text attachment, skipping:", e);
      }
    } else {
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        blocks.push({
          type: "file",
          file: { filename: name, file_data: `data:${ct};base64,${b64}` },
        });
      } catch (e) {
        logger.warn("Failed to fetch binary attachment, skipping:", e);
      }
    }
  }

  // 2) Inline Discord CDN URLs
  const discordCdnInline =
    message.content.match(
      /https?:\/\/cdn\.discordapp\.com\/attachments\/\d+\/\d+\/[^\s"<>]+(?:\?[^\s"<>]*)?/gi
    ) || [];
  for (const url of discordCdnInline) {
    const bare = stripQuery(url);
    if (!seenImages.has(bare)) {
      blocks.push({ type: "image_url", image_url: { url } });
      seenImages.add(bare);
    }
  }

  // 3) Inline images by extension
  const inlineImageUrls =
    message.content.match(
      /https?:\/\/[^\s"<>]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"<>]*)?/gi
    ) || [];
  for (const raw of inlineImageUrls) {
    const clean = stripQuery(raw);
    if (seenImages.has(clean)) continue;
    if (isTrustedImageHost(clean)) {
      blocks.push({ type: "image_url", image_url: { url: clean } });
    } else {
      try {
        const res = await fetch(clean);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct =
          res.headers.get("content-type") || "application/octet-stream";
        const buf = await res.arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        blocks.push({
          type: "image_url",
          image_url: { url: `data:${ct};base64,${b64}` },
        });
      } catch {
        logger.warn(`Failed to fetch inline image, using raw URL: ${clean}`);
        blocks.push({ type: "image_url", image_url: { url: clean } });
      }
    }
    seenImages.add(clean);
  }

  // 4) Tenor GIF extraction
  if (tenorApiKey) {
    const tenorLinks =
      message.content.match(/https?:\/\/tenor\.com\/view\/\S+/gi) || [];
    for (const link of tenorLinks) {
      skipPages.add(stripQuery(link));
      const m = link.match(/-([0-9]+)(?:$|\?)/);
      const id = m?.[1];
      if (!id) continue;
      try {
        const res = await fetch(
          `https://tenor.googleapis.com/v2/posts?ids=${id}&key=${tenorApiKey}`
        );
        const json = (await res.json()) as TenorPostsResponse;
        const gifUrl = json.results?.[0]?.media_formats?.gif?.url;
        if (gifUrl) {
          const bare = stripQuery(gifUrl);
          if (!seenImages.has(bare)) {
            blocks.push({ type: "image_url", image_url: { url: gifUrl } });
            seenImages.add(bare);
          }
        }
      } catch (e) {
        logger.error(`Tenor lookup failed for ${id}:`, e);
      }
    }
  }

  // 5) Giphy GIF extraction
  if (giphyApiKey) {
    const gf = new GiphyFetch(giphyApiKey);
    const giphyLinks =
      message.content.match(
        /https?:\/\/(?:www\.)?giphy\.com\/gifs\/[^\s"<>]+/gi
      ) || [];
    for (const link of giphyLinks) {
      skipPages.add(stripQuery(link));
      const parts = link.split("-");
      const id = parts.pop();
      if (!id) continue;
      try {
        const { data } = await gf.gif(id);
        const gifUrl = data.images.original.url;
        const bare = stripQuery(gifUrl);
        if (!seenImages.has(bare)) {
          blocks.push({ type: "image_url", image_url: { url: gifUrl } });
          seenImages.add(bare);
        }
      } catch (e) {
        logger.error(`GiphyFetch failed for ${id}:`, e);
      }
    }
  }

  // 6) Generic links
  const allLinks = message.content.match(/https?:\/\/[^\s"<>]+/gi) || [];
  const genericUrls = allLinks.filter((url) => {
    const bare = stripQuery(url);
    if (seenImages.has(bare) || skipPages.has(bare)) return false;
    return !/\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(bare);
  });

  return { blocks, genericUrls };
}
