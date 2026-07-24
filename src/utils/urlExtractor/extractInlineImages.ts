/**
 * @file src/utils/urlExtractor/extractInlineImages.ts
 * @description Scans message content for direct image URLs and inlines or references them as Blocks.
 */

import { Block } from "@/types/block.js";
import { stripQuery } from "@/utils/discordHelpers.js";
import logger from "@/utils/logger.js";
import { Message } from "discord.js";

const TRUSTED_IMAGE_HOSTS = ["cdn.discordapp.com", "media.tenor.com", "media.giphy.com"];

/** Largest untrusted image the bot will download and inline as base64. */
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

/** Abort untrusted image downloads that take longer than this. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Detect hostnames that point at loopback, private, or link-local addresses. The bot
 * fetches user-supplied URLs, so without this a message could aim it at internal
 * services (SSRF). Covers name and IP-literal forms only; DNS-level tricks are out of
 * scope for a chat bot.
 * @param hostname - Hostname from a parsed URL (IPv6 literals keep their brackets).
 * @returns True when the host must not be fetched.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.includes(":")) {
    return host === "::1" || host === "::" || /^(?:fe80|fc|fd)/.test(host);
  }
  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return false;
}

/**
 * Extracts inline images from message text, embedding trusted hosts directly and inlining
 * others as base64. Untrusted downloads are capped in size, time-limited, and blocked from
 * private network addresses.
 * @param message - The incoming Discord.js Message.
 * @param blocks - Array to append image_url Blocks.
 * @param seen - Set of URL keys already included.
 * @param allow - Whether inline image extraction is enabled.
 */
export async function extractInlineImages(
  message: Message,
  blocks: Block[],
  seen: Set<string>,
  allow: boolean,
): Promise<void> {
  if (!allow) return;

  const matches = message.content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi) || [];

  for (const rawUrl of matches) {
    const key = stripQuery(rawUrl);
    if (seen.has(key)) continue;
    const host = new URL(rawUrl).hostname;

    if (TRUSTED_IMAGE_HOSTS.includes(host)) {
      blocks.push({ type: "image_url", image_url: { url: rawUrl } });
    } else if (isPrivateHost(host)) {
      logger.warn(`[extractInlineImages] Blocked private-network URL ${rawUrl}`);
      seen.add(key);
      continue;
    } else {
      try {
        const res = await fetch(rawUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) throw new Error(`Not an image: ${contentType}`);
        const declared = Number(res.headers.get("content-length") || 0);
        if (declared > MAX_INLINE_IMAGE_BYTES) throw new Error(`Too large: ${declared} bytes`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > MAX_INLINE_IMAGE_BYTES) {
          throw new Error(`Too large: ${buf.byteLength} bytes`);
        }
        blocks.push({
          type: "image_url",
          image_url: { url: `data:${contentType};base64,${buf.toString("base64")}` },
        });
      } catch (err) {
        blocks.push({ type: "image_url", image_url: { url: rawUrl } });
        logger.warn(`[extractInlineImages] Failed to inline ${rawUrl}, using raw URL`, err);
      }
    }

    seen.add(key);
  }
}
