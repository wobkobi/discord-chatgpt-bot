import { GeneralMemoryEntry } from "@/types/memory";

/** Maximum total characters we keep per-user */
export const MAX_MEMORY_CHARS = 1_000;

/**
 * Trim a user's long-term memory so its total character count never exceeds `maxChars`.
 * Oldest entries are discarded first.
 * @param entries - Memory entries in chronological (oldest-first) order.
 * @param maxChars - Hard cap for the combined `content.length`; defaults to {@link MAX_MEMORY_CHARS}.
 * @returns A new array containing the most recent entries whose total size ≤ `maxChars`.
 */
export function trimMemory(
  entries: GeneralMemoryEntry[],
  maxChars: number = MAX_MEMORY_CHARS,
): GeneralMemoryEntry[] {
  let total = 0;
  let start = entries.length;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (total + entries[i].content.length > maxChars) break;
    total += entries[i].content.length;
    start = i;
  }
  return entries.slice(start);
}
