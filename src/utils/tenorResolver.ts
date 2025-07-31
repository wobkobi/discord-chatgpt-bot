import { TenorSearchResponse } from "@/types/tenor.js";
import fetch from "node-fetch";
import { getOptional } from "../utils/env.js";
import logger from "../utils/logger.js";

const TENOR_API_KEY = getOptional("TENOR_API_KEY");
const SEARCH_LIMIT = 3;

/**
 * Scans text for Tenor "view" URLs, extracts search keywords,
 * queries the Tenor API up to a SEARCH_LIMIT, verifies each GIF URL,
 * and replaces each link with the first valid GIF URL found.
 * @param inputText The text potentially containing tenor.com/view/... links.
 * @returns The text with valid Tenor GIF links replaced.
 */
export async function resolveTenorLinks(inputText: string): Promise<string> {
  if (!TENOR_API_KEY) {
    logger.warn("[tenor] No TENOR_API_KEY provided; skipping resolution");
    return inputText;
  }

  logger.debug("[tenor] Starting link resolution");

  // Find every Tenor view URL and its slug
  const matches = Array.from(
    inputText.matchAll(/https?:\/\/tenor\.com\/view\/([\w-]+)-\d+/g),
    (m) => ({ full: m[0], slug: m[1] })
  );
  const replacements = new Map<string, string>();

  for (const { full: originalUrl, slug } of matches) {
    if (replacements.has(originalUrl)) continue;

    // Clean up slug: remove trailing '-gif' and numbers
    const query = slug
      .replace(/-gif$/i, "")
      .replace(/-\d+$/, "")
      .split("-")
      .join(" ");
    const apiUrl = `https://api.tenor.com/v1/search?q=${encodeURIComponent(
      query
    )}&key=${TENOR_API_KEY}&limit=${SEARCH_LIMIT}`;

    try {
      logger.debug(`[tenor] Searching for "${query}" (limit=${SEARCH_LIMIT})`);
      const resp = await fetch(apiUrl);
      if (!resp.ok) {
        logger.warn(`[tenor] Search failed (${resp.status}) for "${query}"`);
        continue;
      }

      const { results } = (await resp.json()) as TenorSearchResponse;
      // Try each result until a valid GIF is found
      let validGif: string | null = null;
      for (const result of results) {
        const gifUrl = result.media?.[0]?.gif?.url;
        if (!gifUrl) continue;

        // Verify the GIF URL actually resolves to an image
        try {
          const headResp = await fetch(gifUrl, { method: "HEAD" });
          const contentType = headResp.headers.get("content-type") ?? "";
          if (headResp.ok && contentType.startsWith("image")) {
            validGif = gifUrl;
            break;
          } else {
            logger.warn(
              `[tenor] Invalid HEAD for ${gifUrl} status=${headResp.status} ct=${contentType}`
            );
          }
        } catch (headErr) {
          logger.error(`[tenor] HEAD check error for ${gifUrl}`, headErr);
        }
      }

      if (validGif) {
        logger.debug(`[tenor] Replacing "${originalUrl}" → ${validGif}`);
        replacements.set(originalUrl, validGif);
      } else {
        logger.debug(`[tenor] No valid GIF found for slug="${slug}"`);
      }
    } catch (err) {
      logger.error(`[tenor] Search error for slug="${slug}"`, err);
    }
  }

  // Apply replacements
  let resolvedText = inputText;
  for (const [originalUrl, gifUrl] of replacements) {
    resolvedText = resolvedText.replaceAll(originalUrl, gifUrl);
  }

  logger.debug("[tenor] Finished link resolution");
  return resolvedText;
}
