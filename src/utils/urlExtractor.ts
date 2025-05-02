/**
 * @file src/utils/urlExtractor.ts
 * @description Extracts and normalizes attachments and inline media into ChatGPT Block inputs
 *              (text, image_url, file for PDFs), plus remaining “generic” links from a Discord message.
 */

import { Block } from "@/types/index.js";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { Message } from "discord.js";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { stripQuery } from "./discordHelpers.js";
import logger from "./logger.js";

dotenv.config();

interface TenorMediaFormats {
  gif?: {
    url: string;
  };
}
interface TenorPost {
  media_formats: TenorMediaFormats;
}
interface TenorPostsResponse {
  results: TenorPost[];
}

function isTrustedImageHost(url: string): boolean {
  return (
    url.startsWith("https://cdn.discordapp.com") ||
    url.includes("media.tenor.com") ||
    url.includes("media.giphy.com")
  );
}

export async function extractInputs(
  message: Message
): Promise<{ blocks: Block[]; genericUrls: string[] }> {
  const tenorApiKey = process.env.TENOR_API_KEY;
  const giphyApiKey = process.env.GIPHY_API_KEY;

  const blocks: Block[] = [];
  const seenImages = new Set<string>();
  const skipPages = new Set<string>();

  for (const a of message.attachments.values()) {
    const url = a.url;
    const bare = stripQuery(url);
    const name = a.name || "file";
    // discord.js provides contentType if known
    const ct = a.contentType || "application/octet-stream";

    if (ct.startsWith("image/")) {
      // image attachments
      blocks.push({ type: "image_url", image_url: { url } });
      seenImages.add(bare);
    } else if (ct.startsWith("text/")) {
      // text attachments (any text/*)
      try {
        const res = await fetch(url);
        const txt = await res.text();
        // guess extension from name
        const ext = name.split(".").pop() || "txt";
        blocks.push({
          type: "text",
          text: `\`\`\`${ext}\n${txt}\n\`\`\``,
        });
      } catch (e) {
        logger.warn("Failed to fetch text attachment, skipping:", e);
      }
    } else {
      // everything else: embed as file block
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        blocks.push({
          type: "file",
          file: {
            filename: name,
            file_data: `data:${ct};base64,${b64}`,
          },
        });
      } catch (e) {
        logger.warn("Failed to fetch binary attachment, skipping:", e);
      }
    }
  }

  // 2) DISCORD‐CDN inline URLs (including querystrings)
  const discordCdnInline =
    message.content.match(
      /https?:\/\/cdn\.discordapp\.com\/attachments\/\d+\/\d+\/[^\s"<>]+(?:\?[^\s"<>]*)?/gi
    ) ?? [];
  for (const url of discordCdnInline) {
    const bare = stripQuery(url);
    if (!seenImages.has(bare)) {
      blocks.push({ type: "image_url", image_url: { url } });
      seenImages.add(bare);
    }
  }

  // 3) INLINE IMAGES BY EXTENSION (other hosts)
  const inlineImageUrls =
    message.content.match(
      /https?:\/\/[^\s"<>]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"<>]*)?/gi
    ) ?? [];
  for (const raw of inlineImageUrls) {
    const clean = stripQuery(raw);
    if (seenImages.has(clean)) continue;

    if (isTrustedImageHost(clean)) {
      blocks.push({ type: "image_url", image_url: { url: clean } });
    } else {
      // fetch & embed as data URI
      try {
        const res = await fetch(clean);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct =
          res.headers.get("content-type") ?? "application/octet-stream";
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

  // 4) TENOR GIFS via v2/posts lookup
  if (tenorApiKey) {
    const tenorLinks =
      message.content.match(/https?:\/\/tenor\.com\/view\/\S+/gi) ?? [];
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

  // 5) GIPHY via SDK
  if (giphyApiKey) {
    const gf = new GiphyFetch(giphyApiKey);
    const giphyLinks =
      message.content.match(
        /https?:\/\/(?:www\.)?giphy\.com\/gifs\/[^\s"<>]+/gi
      ) ?? [];
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

  // 6) GENERIC LINKS
  const allLinks = message.content.match(/https?:\/\/[^\s"<>]+/gi) ?? [];
  const genericUrls = allLinks.filter((url) => {
    const bare = stripQuery(url);
    if (seenImages.has(bare)) return false;
    if (skipPages.has(bare)) return false;
    return !/\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(bare);
  });

  return { blocks, genericUrls };
}
