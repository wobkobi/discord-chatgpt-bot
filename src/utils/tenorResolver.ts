import { TenorSearchResponse } from "@/types/tenor.js";
import fetch from "node-fetch";
import { getOptional } from "../utils/env.js";
import logger from "../utils/logger.js";

const TENOR_API_KEY = getOptional("TENOR_API_KEY");

/**
 * Scans text for Tenor "view" URLs, extracts search keywords,
 * queries the Tenor API, and replaces each link with a working GIF URL.
 * @param content The text potentially containing tenor.com/view/... links.
 * @returns The text with tenor links replaced by actual GIF URLs.
 */
export async function resolveTenorLinks(content: string): Promise<string> {
  if (!TENOR_API_KEY) {
    logger.warn("[tenor] No TENOR_API_KEY provided; skipping resolution");
    return content;
  }

  const tenorRe = /https?:\/\/tenor\.com\/view\/([\w-]+)-\d+/g;
  let match: RegExpExecArray | null;
  const processed = new Set<string>();

  logger.debug("[tenor] Starting link resolution");

  while ((match = tenorRe.exec(content))) {
    const fullMatch = match[0];
    const slug = match[1];

    if (processed.has(slug)) {
      logger.debug(`[tenor] Skipping already-processed slug: ${slug}`);
      continue;
    }
    processed.add(slug);

    // Clean up slug: remove trailing '-gif' and numbers
    const query = slug
      .replace(/-gif$/i, "")
      .replace(/-\d+$/, "")
      .split("-")
      .join(" ");

    const url = `https://api.tenor.com/v1/search?q=${encodeURIComponent(
      query
    )}&key=${TENOR_API_KEY}&limit=1`;

    try {
      logger.debug(`[tenor] Fetching GIF for query="${query}" from ${url}`);
      const resp = await fetch(url);

      if (!resp.ok) {
        logger.warn(`[tenor] Non-2xx response for "${query}": ${resp.status}`);
        continue;
      }

      const json = (await resp.json()) as TenorSearchResponse;
      const gifUrl = json.results?.[0]?.media?.[0]?.gif?.url;

      if (gifUrl) {
        logger.debug(
          `[tenor] Replacing all instances of "${fullMatch}" with: ${gifUrl}`
        );
        content = content.replaceAll(fullMatch, gifUrl);
      } else {
        logger.debug(`[tenor] No GIF results for slug="${slug}"`);
      }
    } catch (err) {
      logger.error(`[tenor] Error resolving "${slug}"`, err);
      // leave original links intact
    }
  }

  logger.debug("[tenor] Finished link resolution");
  return content;
}
