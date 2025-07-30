import { TenorSearchResponse } from "@/types/tenor.js";
import fetch from "node-fetch";
import { getRequired } from "../utils/env.js";

const TENOR_API_KEY = getRequired("TENOR_API_KEY");

/**
 * Scans text for Tenor "view" URLs, extracts search keywords,
 * queries the Tenor API, and replaces each link with a working GIF URL.
 * @param content The text potentially containing tenor.com/view/... links.
 * @returns The text with tenor links replaced by actual GIF URLs.
 */
export async function resolveTenorLinks(content: string): Promise<string> {
  const tenorRe = /https?:\/\/tenor\.com\/view\/([\w-]+)-\d+/g;
  let match: RegExpExecArray | null;
  const processed = new Set<string>();

  while ((match = tenorRe.exec(content))) {
    const slug = match[1];
    if (processed.has(slug)) continue;
    processed.add(slug);

    // Clean up slug: remove trailing '-gif' and numbers
    const query = slug
      .replace(/-gif$/i, "")
      .replace(/-\d+$/, "")
      .split("-")
      .join(" ");

    try {
      const url = `https://api.tenor.com/v1/search?q=${encodeURIComponent(
        query
      )}&key=${TENOR_API_KEY}&limit=1`;
      const resp = await fetch(url);
      if (!resp.ok) {
        // if the API returns a non-2xx, skip replacing this slug
        continue;
      }

      // Now json has a well-defined type
      const json = (await resp.json()) as TenorSearchResponse;
      const gifUrl = json.results?.[0]?.media?.[0]?.gif?.url;
      if (gifUrl) {
        content = content.replace(match[0], gifUrl);
      }
    } catch {
      // On error, leave original link
    }
  }

  return content;
}
