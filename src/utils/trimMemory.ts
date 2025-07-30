import { GeneralMemoryEntry } from "@/types/memory";

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
  const out = [...entries]; // oldest → newest
  let total = out.reduce((n, e) => n + e.content.length, 0);
  while (total > maxChars && out.length) {
    const removed = out.shift()!; // drop oldest
    total -= removed.content.length;
  }
  return out;
}
