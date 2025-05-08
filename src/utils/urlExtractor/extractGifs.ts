/**
 * @file src/utils/urlExtractor/extractGifs.ts
 * @description Fetches and embeds GIFs from Tenor and Giphy services into ChatGPT Blocks.
 * @remarks
 *   - extractTenorGifs: calls Tenor API to retrieve GIF URLs by message links.
 *   - extractGiphyGifs: uses GiphyFetch to fetch GIFs from Giphy links.
 *   - Avoids duplicates using seen and skip sets.
 *   - Honour allowInline flag and API key presence.
 *   - Logs detailed debug info via logger.debug and errors via logger.error.
 */

import { Block } from "@/types";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { Message } from "discord.js";
import { IMAGE_EXT_RE } from ".";
import { stripQuery } from "../discordHelpers";
import logger from "../logger";

// Types for Tenor API response
interface TenorPost {
  media_formats: { gif?: { url: string } };
}
interface TenorPostsResponse {
  results: TenorPost[];
}

/**
 * Fetches and embeds Tenor GIFs by ID parsed from Discord message links.
 *
 * @param message - The Discord.js Message containing Tenor links.
 * @param blocks - Array to append image_url Blocks.
 * @param seen - Set of image URL keys already processed.
 * @param skip - Set of original links to skip in generic URLs.
 * @param apiKey - Tenor API key.
 * @param allow - Whether embedding is permitted.
 */
export async function extractTenorGifs(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  skip: Set<string>,
  apiKey: string,
  allow: boolean
): Promise<void> {
  logger.debug("[extractGifs] extractTenorGifs invoked");
  if (!apiKey || !allow) return;
  const links =
    message.content.match(/https?:\/\/tenor\.com\/view\/\S+/gi) || [];
  for (const link of links) {
    skip.add(stripQuery(link));
    const id = link.match(/-(\d+)(?:$|\?)/)?.[1];
    if (!id) continue;
    try {
      const res = await fetch(
        `https://tenor.googleapis.com/v2/posts?ids=${id}&key=${apiKey}`
      );
      const json = (await res.json()) as TenorPostsResponse;
      const url = json.results[0]?.media_formats.gif?.url;
      if (url) {
        blocks.push({ type: "image_url", image_url: { url } });
        seen.add(stripQuery(url));
        logger.debug(`[extractGifs] Tenor GIF added: ${url}`);
      }
    } catch (err) {
      logger.error(`[extractGifs] Tenor error for link ${link}`, err);
    }
  }
}

/**
 * Fetches and embeds Giphy GIFs by parsing IDs from Discord message URLs.
 *
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
  allow: boolean
): Promise<void> {
  logger.debug("[extractGifs] extractGiphyGifs invoked");
  if (!apiKey || !allow) return;
  const gf = new GiphyFetch(apiKey);
  const links =
    message.content.match(/https?:\/\/\S+\.giphy\.com\/gifs\/\S+/gi) || [];
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
        logger.debug(`[extractGifs] Giphy GIF added: ${url}`);
      }
    } catch (err) {
      logger.error(`[extractGifs] Giphy error for link ${link}`, err);
    }
  }
}
