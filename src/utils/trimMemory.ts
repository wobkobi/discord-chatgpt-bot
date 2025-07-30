import { GeneralMemoryEntry } from "@/types/memory";
import logger from "../utils/logger.js";

/** Maximum total characters we keep per-user */
export const MAX_MEMORY_CHARS = 1_000;

/**
 * Trim a user’s long-term memory so its total character count
 * never exceeds `maxChars`.
 * Oldest entries are discarded first.
 * @param entries  – Memory entries in chronological (oldest-first) order.
 * @param maxChars – Hard cap for the combined `content.length`; defaults to {@link MAX_MEMORY_CHARS}.
 * @returns A **new** array containing the most recent entries whose total size ≤ `maxChars`.
 */
export function trimMemory(
  entries: GeneralMemoryEntry[],
  maxChars: number = MAX_MEMORY_CHARS
): GeneralMemoryEntry[] {
  logger.debug(
    `[memory] Trimming memory: count=${entries.length}, maxChars=${maxChars}`
  );

  const out = [...entries]; // oldest → newest
  let total = out.reduce((n, e) => n + e.content.length, 0);
  logger.debug(`[memory] Total characters before trim: ${total}`);

  while (total > maxChars && out.length) {
    const removed = out.shift()!; // drop oldest
    total -= removed.content.length;
    logger.debug(
      `[memory] Removed entry timestamp=${removed.timestamp}, length=${removed.content.length}, newTotal=${total}`
    );
  }

  logger.debug(
    `[memory] Finished trimming: remainingCount=${out.length}, totalChars=${total}`
  );
  return out;
}
