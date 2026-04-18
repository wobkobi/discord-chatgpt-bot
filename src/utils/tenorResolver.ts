/**
 * @file src/utils/tenorResolver.ts
 * @description Resolves tenor.com/view/... links to direct GIF URLs via the Tenor V2 API.
 */

import { TenorResult, TenorSearchResponse } from "@/types/tenor.js";
import { getOptional } from "@/utils/env.js";
import logger from "@/utils/logger.js";
import fetch from "node-fetch";

const TENOR_API_KEY = getOptional("TENOR_API_KEY");
const CLIENT_KEY = getOptional("TENOR_CLIENT_KEY") || "discord-bot";
const COUNTRY = (() => {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const parts = locale.split("-");
  return (parts[1] || parts[0] || "US").toUpperCase();
})();
const SEARCH_LIMIT = 3;

/**
 * Replace each tenor.com/view/... link in the text with the first valid GIF URL from the Tenor API.
 * Direct GIF URLs (media.tenor.com) are left intact.
 * @param inputText - The text potentially containing tenor.com/view/... links.
 * @returns The text with resolved Tenor links replaced by direct GIF URLs.
 */
export async function resolveTenorLinks(inputText: string): Promise<string> {
  if (!TENOR_API_KEY) {
    logger.warn("[tenor] No TENOR_API_KEY provided; skipping resolution");
    return inputText;
  }

  const tenorRe =
    /https?:\/\/(?:[\w-]+\.)?tenor\.com\/(?:(?:view\/([\w-]+)-\d+)|(?:[\w/.-]+\.gif))/g;
  const matches = Array.from(inputText.matchAll(tenorRe), (m) => ({
    full: m[0],
    slug: m[1],
  }));

  const replacements = new Map<string, string>();

  for (const { full, slug } of matches) {
    if (replacements.has(full)) continue;

    const query = slug.replace(/-gif$/i, "").replace(/-\d+$/, "").split("-").join(" ");

    let gifUrl = await searchGif(query);
    if (!gifUrl) {
      const simplified = query.split(" ").slice(0, 2).join(" ");
      if (simplified !== query) gifUrl = await searchGif(simplified);
    }

    if (gifUrl) {
      replacements.set(full, gifUrl);
    } else {
      logger.warn(`[tenor] No valid GIF found for link: ${full}`);
    }
  }

  let out = inputText;
  for (const [from, to] of replacements) {
    out = out.replaceAll(from, to);
  }
  return out;
}

/**
 * Scans text for `[GIF: keywords]` placeholders the AI may include in its response,
 * searches Tenor for each, and replaces the placeholder with a direct GIF URL.
 * Placeholders with no result are removed silently.
 * @param text - The AI-generated response text to process.
 * @returns The text with all `[GIF: ...]` placeholders resolved or removed.
 */
export async function resolveGifPlaceholders(text: string): Promise<string> {
  if (!TENOR_API_KEY) return text;

  const re = /\[GIF:\s*([^\]]+)\]/gi;
  const matches = Array.from(text.matchAll(re));
  if (!matches.length) return text;

  let result = text;
  for (const match of matches) {
    const keywords = match[1].trim();
    const url = await searchGif(keywords);
    result = result.replace(match[0], url ?? "");
  }
  return result.replace(/ {2,}/g, " ").trim();
}

/**
 * Query Tenor V2 search and return the first HEAD-validated GIF URL, or null if none found.
 * @param query - Keywords to search for.
 * @returns A valid GIF URL or null if none found.
 */
async function searchGif(query: string): Promise<string | null> {
  const apiUrl =
    `https://tenor.googleapis.com/v2/search?` +
    `key=${TENOR_API_KEY}` +
    `&client_key=${CLIENT_KEY}` +
    `&q=${encodeURIComponent(query)}` +
    `&limit=${SEARCH_LIMIT}` +
    `&media_filter=gif` +
    `&country=${COUNTRY}`;

  let resp;
  try {
    resp = await fetch(apiUrl);
  } catch (err: unknown) {
    logger.error(`[tenor] Network error for "${query}"`, err);
    return null;
  }

  if (resp.status === 429) {
    logger.error(`[tenor] Rate limited (429) for query="${query}"`);
    return null;
  }
  if (!resp.ok) {
    logger.warn(`[tenor] Search HTTP ${resp.status} for "${query}"`);
    return null;
  }

  let results: TenorResult[];
  try {
    const json = (await resp.json()) as TenorSearchResponse;
    results = json.results;
  } catch (err: unknown) {
    logger.error(`[tenor] JSON parse error for "${query}"`, err);
    return null;
  }

  for (const r of results) {
    const candidate = r.media_formats?.gif?.url;
    if (!candidate) continue;
    try {
      const head = await fetch(candidate, { method: "HEAD" });
      const ct = head.headers.get("content-type") || "";
      if (head.ok && ct.startsWith("image")) return candidate;
      logger.warn(`[tenor] Invalid HEAD for ${candidate} status=${head.status} ct=${ct}`);
    } catch (err: unknown) {
      logger.error(`[tenor] HEAD check error for ${candidate}`, err);
    }
  }

  logger.warn(`[tenor] No HEAD-validated GIF found for "${query}"`);
  return null;
}
