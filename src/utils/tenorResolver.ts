import { TenorResult, TenorSearchResponse } from "@/types/tenor.js";
import fetch from "node-fetch";
import { getOptional } from "../utils/env.js";
import logger from "../utils/logger.js";

const TENOR_API_KEY = getOptional("TENOR_API_KEY");
const CLIENT_KEY = getOptional("TENOR_CLIENT_KEY") || "discord-bot";
// Derive country code from system locale, fallback to 'US'
const COUNTRY = (() => {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const parts = locale.split("-");
  return (parts[1] || parts[0] || "US").toUpperCase();
})();
const SEARCH_LIMIT = 3;

/**
 * Replace each tenor.com/view/... link in the text with the first valid GIF
 * URL returned by the Tenor V2 search API. Direct GIF URLs (media.tenor.com/*.gif)
 * are detected and left intact, with a debug log entry. Detailed logging throughout.
 * @param inputText The text potentially containing tenor.com/view/... links.
 * @returns The text with valid Tenor GIF links replaced.
 */
export async function resolveTenorLinks(inputText: string): Promise<string> {
  if (!TENOR_API_KEY) {
    logger.warn("[tenor] No TENOR_API_KEY provided; skipping resolution");
    return inputText;
  }

  logger.debug("[tenor] Starting link resolution");

  // Detect direct GIF URLs (media.tenor.com or c.tenor.com) and log them at info level
  const tenorRe =
    /https?:\/\/(?:[\w-]+\.)?tenor\.com\/(?:(?:view\/([\w-]+)-\d+)|(?:[\w/.-]+\.gif))/g;
  const matches = Array.from(inputText.matchAll(tenorRe), (m) => ({
    full: m[0],
    slug: m[1],
  }));
  logger.debug(`[tenor] Found ${matches.length} tenor.com links to resolve`);

  const replacements = new Map<string, string>();

  for (const { full, slug } of matches) {
    logger.debug(`[tenor] Processing link: ${full}`);
    if (replacements.has(full)) {
      logger.debug(`[tenor] Already processed: ${full}`);
      continue;
    }

    const query = slug
      .replace(/-gif$/i, "")
      .replace(/-\d+$/, "")
      .split("-")
      .join(" ");
    logger.debug(`[tenor] Search query: "${query}"`);

    let gifUrl = await searchGif(query);
    if (!gifUrl) {
      const simplified = query.split(" ").slice(0, 2).join(" ");
      if (simplified !== query) {
        logger.debug(`[tenor] Retrying with simplified query: "${simplified}"`);
        gifUrl = await searchGif(simplified);
      }
    }

    if (gifUrl) {
      logger.debug(`[tenor] Will replace "${full}" → ${gifUrl}`);
      replacements.set(full, gifUrl);
    } else {
      logger.warn(`[tenor] No valid GIF found for link: ${full}`);
    }
  }

  let out = inputText;
  for (const [from, to] of replacements) {
    out = out.replaceAll(from, to);
    logger.debug(`[tenor] Replaced link: ${from}`);
  }

  logger.debug("[tenor] Finished link resolution");
  return out;
}

/**
 * Query Tenor V2 search and return first valid GIF URL or null.
 * @param query Keywords to search.
 * @returns A valid GIF URL or null if none found.
 */
async function searchGif(query: string): Promise<string | null> {
  const apiUrl =
    `https://tenor.googleapis.com/v2/search?key=${TENOR_API_KEY}` +
    `&client_key=${CLIENT_KEY}` +
    `&q=${encodeURIComponent(query)}` +
    `&limit=${SEARCH_LIMIT}` +
    `&media_filter=gif` +
    `&country=${COUNTRY}`;

  // Redact the API key from the logged URL
  const redactedApiUrl = apiUrl.replace(/(key=)[^&]+/, '$1[REDACTED]');
  logger.debug(`[tenor] Fetching V2 API: ${redactedApiUrl}`);
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
    logger.debug(`[tenor] Retrieved ${results.length} result(s)`);
  } catch (err: unknown) {
    logger.error(`[tenor] JSON parse error for "${query}"`, err);
    return null;
  }

  for (const r of results) {
    const candidate = r.media_formats?.gif?.url;
    if (!candidate) continue;
    logger.debug(`[tenor] Checking candidate GIF HEAD: ${candidate}`);
    try {
      const head = await fetch(candidate, { method: "HEAD" });
      const ct = head.headers.get("content-type") || "";
      if (head.ok && ct.startsWith("image")) {
        logger.debug(`[tenor] Valid GIF found: ${candidate}`);
        return candidate;
      } else {
        logger.warn(
          `[tenor] Invalid HEAD for ${candidate} status=${head.status} ct=${ct}`
        );
      }
    } catch (err: unknown) {
      logger.error(`[tenor] HEAD check error for ${candidate}`, err);
    }
  }

  logger.warn(`[tenor] No HEAD-validated GIF found for "${query}"`);
  return null;
}
