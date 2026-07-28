// src/utils/urlExtractor/extractGifs.ts
/**
 * @description Fetches and embeds GIFs from Tenor, Giphy, and Klipy links into ChatGPT Blocks.
 */

import { Block } from "@/types/block.js";
import { stripQuery } from "@/utils/discordHelpers.js";
import logger from "@/utils/logger.js";
import { IMAGE_EXT_RE } from "@/utils/urlExtractor/index.js";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { Message } from "discord.js";

/** Abort a Tenor page fetch that hangs rather than stalling the whole reply. */
const TENOR_FETCH_TIMEOUT_MS = 5_000;

/** Direct GIF asset on Tenor's CDN; the host is numbered (media1, media2, ...). */
const TENOR_MEDIA_RE = /^https:\/\/media\d*\.tenor\.com\/\S+$/i;

/** Tenor serves the direct GIF URL as og:image on every view page. */
const OG_IMAGE_RE = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i;

/**
 * Resolves a tenor.com/view page to its direct GIF URL by reading the og:image meta tag.
 * Tenor's API was discontinued, but the public pages still carry the asset URL, and a
 * removed or invented GIF 404s here - which is what keeps dead links out of the prompt.
 * @param link - The tenor.com/view page URL.
 * @returns The direct media.tenor.com GIF URL, or null when the page is gone or unparseable.
 */
async function resolveTenorPage(link: string): Promise<string | null> {
  const res = await fetch(link, {
    signal: AbortSignal.timeout(TENOR_FETCH_TIMEOUT_MS),
    headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
  });
  if (!res.ok) {
    logger.warn(`[extractGifs] Tenor page ${link} returned HTTP ${res.status}`);
    return null;
  }
  const url = OG_IMAGE_RE.exec(await res.text())?.[1];
  if (!url || !TENOR_MEDIA_RE.test(url)) {
    logger.warn(`[extractGifs] No usable og:image on ${link}`);
    return null;
  }
  return url;
}

/**
 * Fetches and embeds Tenor GIFs linked in a Discord message.
 * @param message - The Discord.js Message containing Tenor links.
 * @param blocks - Array to append image_url Blocks.
 * @param seen - Set of image URL keys already processed.
 * @param skip - Set of original links to skip in generic URLs.
 * @param allow - Whether embedding is permitted.
 */
export async function extractTenorGifs(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  skip: Set<string>,
  allow: boolean,
): Promise<void> {
  if (!allow) return;
  const links = message.content.match(/https?:\/\/tenor\.com\/view\/\S+/gi) || [];
  for (const link of links) {
    skip.add(stripQuery(link));
    try {
      const url = await resolveTenorPage(link);
      if (url) {
        blocks.push({ type: "image_url", image_url: { url } });
        seen.add(stripQuery(url));
      }
    } catch (err) {
      logger.error(`[extractGifs] Tenor error for link ${link}`, err);
    }
  }
}

/** Klipy is the GIF library Discord now uses; its API takes the key as a path segment. */
const KLIPY_BASE = "https://api.klipy.com/api/v1";

/** Abort a Klipy lookup that hangs rather than stalling the whole reply. */
const KLIPY_FETCH_TIMEOUT_MS = 5_000;

/**
 * Size tiers to offer the model, best first. `md` leads because it is ample for vision
 * at a fraction of `hd`'s bytes; `hd` is only reached if the smaller tiers are absent.
 */
const KLIPY_TIERS = ["md", "sm", "hd", "xs"] as const;

/** Largest asset worth handing to the model. */
const KLIPY_MAX_BYTES = 8 * 1024 * 1024;

interface KlipyRendition {
  url?: string;
  size?: number;
}
interface KlipyGifResponse {
  result?: boolean;
  data?: { file?: Partial<Record<(typeof KLIPY_TIERS)[number], { gif?: KlipyRendition }>> };
}

/**
 * Pick the best Klipy GIF rendition within the size budget.
 * @param file - The tiered asset map from a Klipy response.
 * @returns A direct GIF URL, or null when nothing suitable is present.
 */
function pickKlipyGif(file: NonNullable<KlipyGifResponse["data"]>["file"]): string | null {
  if (!file) return null;
  for (const tier of KLIPY_TIERS) {
    const gif = file[tier]?.gif;
    if (gif?.url && (!gif.size || gif.size <= KLIPY_MAX_BYTES)) return gif.url;
  }
  return null;
}

/**
 * Fetches and embeds Klipy GIFs linked in a Discord message. The slug in a
 * klipy.com/gifs/... URL is the API's lookup key, so links resolve exactly; an invented
 * or removed slug returns 404 and is skipped.
 * @param message - The Discord.js Message containing Klipy links.
 * @param blocks - Array to append image_url Blocks.
 * @param seen - Set of image URL keys already processed.
 * @param skip - Set of original links to skip in generic URLs.
 * @param apiKey - Klipy API key.
 * @param allow - Whether embedding is permitted.
 */
export async function extractKlipyGifs(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  skip: Set<string>,
  apiKey: string,
  allow: boolean,
): Promise<void> {
  if (!apiKey || !allow) return;
  const links = message.content.match(/https?:\/\/(?:www\.)?klipy\.com\/gifs\/\S+/gi) || [];
  const customerId = message.author?.id || "discord-bot";

  for (const link of links) {
    skip.add(stripQuery(link));
    const slug = /klipy\.com\/gifs\/([\w-]+)/i.exec(link)?.[1];
    if (!slug) continue;
    try {
      const res = await fetch(
        `${KLIPY_BASE}/${apiKey}/gifs/${encodeURIComponent(slug)}?customer_id=${encodeURIComponent(customerId)}`,
        { signal: AbortSignal.timeout(KLIPY_FETCH_TIMEOUT_MS) },
      );
      if (!res.ok) {
        logger.warn(`[extractGifs] Klipy lookup for ${link} returned HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as KlipyGifResponse;
      const url = pickKlipyGif(json.data?.file);
      if (url) {
        blocks.push({ type: "image_url", image_url: { url } });
        seen.add(stripQuery(url));
      } else {
        logger.warn(`[extractGifs] No usable Klipy rendition for ${link}`);
      }
    } catch (err) {
      // Klipy carries the key in the request path, so errors quoting the URL leak it
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        `[extractGifs] Klipy error for link ${link}: ${msg.split(apiKey).join("[redacted]")}`,
      );
    }
  }
}

/**
 * Fetches and embeds Giphy GIFs by parsing IDs from Discord message URLs.
 * @param message - The Discord.js Message containing Giphy links.
 * @param blocks - Array to append image_url Blocks.
 * @param seen - Set of image URL keys already processed.
 * @param skip - Set of original links to skip in generic URLs.
 * @param apiKey - Giphy API key.
 * @param allow - Whether embedding is permitted.
 */
export async function extractGiphyGifs(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  skip: Set<string>,
  apiKey: string,
  allow: boolean,
): Promise<void> {
  if (!apiKey || !allow) return;
  const gf = new GiphyFetch(apiKey);
  const links = message.content.match(/https?:\/\/\S+\.giphy\.com\/gifs\/\S+/gi) || [];
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
    } catch (err) {
      logger.error(`[extractGifs] Giphy error for link ${link}`, err);
    }
  }
}
