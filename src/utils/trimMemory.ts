// src/utils/trimMemory.ts
import { GeneralMemoryEntry } from "@/types/memory";

/** Maximum total characters we keep per-user */
export const MAX_MEMORY_CHARS = 4_000;

/**
 * Trim a user's long-term memory so its total character count never exceeds `maxChars`.
 * Oldest entries are discarded first.
 *
 * The newest entry is always kept, truncated to `maxChars` if it alone overflows the cap.
 * Dropping it instead would return an empty array and wipe the user's whole history the
 * first time a single long reply came through.
 * @param entries - Memory entries in chronological (oldest-first) order.
 * @param maxChars - Hard cap for the combined `content.length`; defaults to {@link MAX_MEMORY_CHARS}.
 * @returns A new array containing the most recent entries whose total size ≤ `maxChars`.
 */
export function trimMemory(
  entries: GeneralMemoryEntry[],
  maxChars: number = MAX_MEMORY_CHARS,
): GeneralMemoryEntry[] {
  if (!entries.length) return [];

  const newest = entries[entries.length - 1];
  if (newest.content.length >= maxChars) {
    return [{ ...newest, content: newest.content.slice(0, maxChars) }];
  }

  let total = 0;
  let start = entries.length;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (total + entries[i].content.length > maxChars) break;
    total += entries[i].content.length;
    start = i;
  }
  return entries.slice(start);
}
