// src/utils/gifResolver.ts
// Resolves the bot's own GIF references to direct, verified GIF URLs via the Giphy API.
// Tenor's API was discontinued, so Giphy is the only search backend; inbound tenor.com
// links from users are handled separately in urlExtractor/extractGifs.ts.

import { getOptional } from "@/utils/env";
import logger from "@/utils/logger";
import { GifsResult, GiphyFetch, Rating } from "@giphy/js-fetch-api";

/** Rendition set attached to a Giphy result; `@giphy/js-types` is not a direct dependency. */
type GiphyImages = GifsResult["data"][number]["images"];
type GiphyRendition = GiphyImages["downsized"];

/** Content ceiling applied to every Giphy search. */
const GIPHY_RATING: Rating = "r";

/** Results to consider per search; the first that passes validation wins. */
const SEARCH_LIMIT = 5;

/**
 * Discord silently declines to embed very large remote GIFs, so anything above this
 * is downgraded to a smaller rendition rather than sent as-is.
 */
const MAX_EMBED_BYTES = 8 * 1024 * 1024;

/** Abort validation requests that hang rather than stalling the whole reply. */
const HEAD_TIMEOUT_MS = 5_000;

/** Giphy rejects anything longer with HTTP 414, so queries are cut to fit. */
const MAX_QUERY_CHARS = 50;

/** Words kept by the narrowed retry when the full phrase returns nothing. */
const FALLBACK_QUERY_WORDS = 3;

let _client: GiphyFetch | undefined;

/**
 * Read the API key. Deliberately lazy: reading at module scope would run before
 * `initialiseEnv()` and throw during import.
 * @returns The configured key, or an empty string when GIFs are disabled.
 */
function apiKey(): string {
  return getOptional("GIPHY_API_KEY");
}

/**
 * Returns the shared Giphy client, constructing it on first use.
 * @returns The client, or null when no API key is configured.
 */
function getClient(): GiphyFetch | null {
  const key = apiKey();
  if (!key) return null;
  _client ??= new GiphyFetch(key);
  return _client;
}

/**
 * Strip the Giphy API key from text destined for logs. Fetch errors embed the full
 * request URL - key included - in their message, so raw errors must never be logged.
 * @param text - Error message or other text that may contain the key.
 * @returns The text with any key occurrences replaced.
 */
function redactKey(text: string): string {
  const key = apiKey();
  return key ? text.split(key).join("[redacted]") : text;
}

/**
 * Pick the largest rendition Discord will actually embed. `size` is a byte count as a
 * string and is occasionally absent, in which case the rendition is treated as unknown
 * and skipped in favour of one with a known, in-budget size.
 * @param images - The rendition set from a Giphy result.
 * @returns The chosen rendition URL, or null when none is usable.
 */
function pickRendition(images: GiphyImages): string | null {
  const candidates: GiphyRendition[] = [images.original, images.downsized_medium, images.downsized];
  for (const rendition of candidates) {
    const bytes = Number(rendition?.size ?? NaN);
    if (rendition?.url && Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_EMBED_BYTES) {
      return rendition.url;
    }
  }
  return candidates.find((r) => r?.url)?.url ?? null;
}

/**
 * Confirm a URL really serves an image before it is put in front of users. Guards against
 * dead CDN entries and against Giphy handing back a non-image asset.
 * @param url - Candidate GIF URL.
 * @returns True when the URL responds OK with an image content type.
 */
async function isLiveImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && contentType.startsWith("image")) return true;
    logger.warn(`[gif] Rejected ${url} status=${res.status} ct=${contentType}`);
  } catch (err: unknown) {
    logger.warn(`[gif] HEAD check failed for ${url}: ${err instanceof Error ? err.message : err}`);
  }
  return false;
}

/**
 * Trim a phrase to Giphy's query ceiling, cutting on a word boundary so the last word is
 * not left as a fragment.
 * @param term - Raw search phrase.
 * @returns A phrase of at most {@link MAX_QUERY_CHARS} characters.
 */
function capLength(term: string): string {
  if (term.length <= MAX_QUERY_CHARS) return term;
  const cut = term.slice(0, MAX_QUERY_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Run one Giphy search and return the first result that survives validation.
 * @param client - The Giphy client.
 * @param term - Search phrase, already within the length limit.
 * @returns A verified GIF URL, or null.
 */
async function searchOnce(client: GiphyFetch, term: string): Promise<string | null> {
  let results;
  try {
    ({ data: results } = await client.search(term, { rating: GIPHY_RATING, limit: SEARCH_LIMIT }));
  } catch (err: unknown) {
    logger.error(
      `[gif] Search failed for "${term}": ${redactKey(err instanceof Error ? err.message : String(err))}`,
    );
    return null;
  }

  for (const gif of results) {
    const url = pickRendition(gif.images);
    if (url && (await isLiveImage(url))) return url;
  }
  return null;
}

/**
 * Search Giphy and return the first result that survives validation. Long phrases - which
 * link slugs routinely produce - are capped to Giphy's limit, and a phrase that matches
 * nothing is retried on its first few words before giving up.
 * @param query - Keywords to search for.
 * @returns A verified GIF URL, or null when nothing usable was found.
 */
export async function searchGif(query: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const term = capLength(query.trim().replace(/\s+/g, " "));
  if (!term) return null;

  const hit = await searchOnce(client, term);
  if (hit) return hit;

  const narrowed = term.split(" ").slice(0, FALLBACK_QUERY_WORDS).join(" ");
  if (narrowed !== term) {
    const fallback = await searchOnce(client, narrowed);
    if (fallback) return fallback;
  }

  logger.warn(`[gif] No verified GIF for "${term}"`);
  return null;
}

/**
 * Turn a GIF page slug into search keywords. Slugs carry a trailing numeric ID and
 * usually a `-gif` suffix, neither of which help a search. Percent-encoded segments are
 * decoded and then dropped - they are typically non-Latin title text that only muddies
 * an English query.
 * @param slug - The slug segment of a GIF page URL.
 * @returns Space-separated keywords.
 */
function slugToQuery(slug: string): string {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // Malformed escapes are left as-is; the strip below removes them anyway
  }
  return decoded
    .replace(/-\d+$/, "")
    .replace(/-gif$/i, "")
    .split("-")
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .join(" ");
}

/**
 * Matches the GIF page links the model may invent - Tenor, Giphy, and Klipy (the library
 * Discord itself now uses). None of these are verifiable as written, so each is re-searched
 * and replaced with a direct URL or dropped.
 */
const GIF_PAGE_PATTERN = String.raw`https?://(?:[\w-]+\.)?(?:tenor\.com/view/|giphy\.com/gifs/|klipy\.com/gifs/)([\w\-%]+?)(?:/|\b)(?=\s|$|[.,!?)])`;

/** Matches the `[GIF: keywords]` placeholder the system prompt asks the model to emit. */
const GIF_PLACEHOLDER_PATTERN = String.raw`\[GIF:\s*([^\]]+)\]`;

/**
 * Build a fresh page-link matcher. These are global regexes, and a shared instance
 * carries `lastIndex` between calls - so `test()` in one function silently makes the
 * next `matchAll()` start mid-string and miss matches.
 * @returns A new global, case-insensitive matcher.
 */
function gifPageRe(): RegExp {
  return new RegExp(GIF_PAGE_PATTERN, "gi");
}

/**
 * Build a fresh placeholder matcher, for the same reason as {@link gifPageRe}.
 * @returns A new global, case-insensitive matcher.
 */
function gifPlaceholderRe(): RegExp {
  return new RegExp(GIF_PLACEHOLDER_PATTERN, "gi");
}

/**
 * True when the text still references a GIF the bot has not verified - either an
 * unresolved placeholder or a page link that was never swapped for a direct URL.
 * @param text - Reply text to inspect.
 * @returns Whether an unverified GIF reference remains.
 */
export function hasUnresolvedGif(text: string): boolean {
  return gifPlaceholderRe().test(text) || gifPageRe().test(text);
}

/**
 * Collapse the whitespace left behind when a GIF reference is removed from a sentence.
 * @param text - Text with a reference already stripped.
 * @returns Tidied text.
 */
function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Replace `[GIF: keywords]` placeholders with verified GIF URLs.
 * @param text - Reply text that may contain placeholders.
 * @param stripUnresolved - When true, placeholders with no result are removed; when
 *   false they are left in place so the caller can detect the failure and re-roll.
 * @returns The text with placeholders resolved, removed, or left pending.
 */
export async function resolveGifPlaceholders(
  text: string,
  stripUnresolved: boolean,
): Promise<string> {
  if (!apiKey()) return text;

  const matches = Array.from(text.matchAll(gifPlaceholderRe()));
  if (!matches.length) return text;

  let result = text;
  for (const match of matches) {
    const url = await searchGif(match[1].trim());
    if (url) {
      result = result.replace(match[0], url);
    } else if (stripUnresolved) {
      result = result.replace(match[0], "");
    }
  }
  return tidy(result);
}

/**
 * Replace tenor.com/view and giphy.com/gifs page links the model wrote itself with
 * verified direct GIF URLs, searching on the keywords carried in the link slug. Such
 * links are almost always invented and rarely resolve, so an unverified one must never
 * reach the channel. Direct CDN links (media.tenor.com, media.giphy.com) are already
 * usable and are left untouched.
 * @param text - Reply text that may contain GIF page links.
 * @param stripUnresolved - When true, links with no result are removed; when false they
 *   are left in place so the caller can detect the failure and re-roll.
 * @returns The text with page links resolved, removed, or left pending.
 */
export async function resolveGifLinks(text: string, stripUnresolved: boolean): Promise<string> {
  if (!apiKey()) return text;

  const matches = Array.from(text.matchAll(gifPageRe()), (m) => ({ full: m[0], slug: m[1] }));
  if (!matches.length) return text;

  const replacements = new Map<string, string | null>();
  for (const { full, slug } of matches) {
    if (replacements.has(full)) continue;
    replacements.set(full, await searchGif(slugToQuery(slug)));
  }

  let result = text;
  for (const [from, to] of replacements) {
    if (to) {
      result = result.replaceAll(from, to);
    } else {
      logger.warn(`[gif] Unresolvable model-written link: ${from}`);
      if (stripUnresolved) result = result.replaceAll(from, "");
    }
  }
  return tidy(result);
}
