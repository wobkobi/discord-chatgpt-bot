import { TenorSearchResponse } from "@/types/tenor.js";
import fetch from "node-fetch";
import { getOptional } from "../utils/env.js";
import logger from "../utils/logger.js";

const TENOR_API_KEY = getOptional("TENOR_API_KEY");

/**
 * Scans text for Tenor "view" URLs, extracts search keywords,
 * queries the Tenor API, verifies the GIF URL is valid,
 * and replaces each link with a working GIF URL.
 * @param inputText  The text potentially containing tenor.com/view/... links.
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

  // Fetch and verify a GIF URL for each unique match
  for (const { full, slug } of matches) {
    if (replacements.has(full)) {
      logger.debug(`[tenor] Already fetched for URL "${full}"`);
      continue;
    }

    // Clean up slug: remove trailing '-gif' and numbers
    const query = slug
      .replace(/-gif$/i, "")
      .replace(/-\d+$/, "")
      .split("-")
      .join(" ");
    const apiUrl = `https://api.tenor.com/v1/search?q=${encodeURIComponent(
      query
    )}&key=${TENOR_API_KEY}&limit=1`;

    try {
      logger.debug(`[tenor] Fetching GIF for query="${query}" from ${apiUrl}`);
      const resp = await fetch(apiUrl);
      if (!resp.ok) {
        logger.warn(
          `[tenor] Non-2xx response (${resp.status}) for query="${query}"`
        );
        continue;
      }

      const json = (await resp.json()) as TenorSearchResponse;
      const gifUrl = json.results?.[0]?.media?.[0]?.gif?.url;

      if (!gifUrl) {
        logger.debug(`[tenor] No GIF found for slug="${slug}"`);
        continue;
      }

      // Verify the GIF URL actually resolves to an image
      try {
        const headResp = await fetch(gifUrl, { method: "HEAD" });
        const contentType = headResp.headers.get("content-type") || "";
        if (!headResp.ok || !contentType.startsWith("image")) {
          logger.warn(
            `[tenor] HEAD check failed for "${gifUrl}" status=${headResp.status} ct=${contentType}`
          );
          continue;
        }
      } catch (headErr) {
        logger.error(`[tenor] Failed HEAD check for "${gifUrl}"`, headErr);
        continue;
      }

      logger.debug(`[tenor] Will replace "${full}" → ${gifUrl}`);
      replacements.set(full, gifUrl);
    } catch (err) {
      logger.error(`[tenor] Error fetching GIF for slug="${slug}"`, err);
    }
  }

  // Apply all valid replacements
  let resolvedText = inputText;
  for (const [full, gifUrl] of replacements) {
    resolvedText = resolvedText.replaceAll(full, gifUrl);
  }

  logger.debug("[tenor] Finished link resolution");
  return resolvedText;
}
