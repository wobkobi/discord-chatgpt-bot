/**
 * @file src/memory/cloneMemory.ts
 * @description Manages the clone memory store: logs interactions for the cloned user persona and persists them to disk.
 */

import { GeneralMemoryEntry } from "@/types";
import { loadCloneMemory, saveCloneMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/**
 * In-memory cache of clone memory entries, keyed by Discord user ID.
 */
export const cloneMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Initialise the in-memory clone memory cache by clearing all entries.
 *
 * @async
 * @returns A promise that resolves once the cache has been cleared.
 */
export async function initialiseCloneMemory(): Promise<void> {
  cloneMemory.clear();
  logger.info("🗂️ Clone memory cache cleared");
}

/**
 * Append a new memory entry for the clone persona, update the cache, and persist to disk.
 *
 * @async
 * @param userId - Discord user ID for which to update the clone memory.
 * @param entry - The memory entry to append, containing timestamp and content.
 * @returns A promise that resolves when the memory has been successfully updated.
 */
export async function updateCloneMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    // Load existing entries from disk (or empty array if none)
    const existingEntries = await loadCloneMemory(userId);

    // Combine with the new entry
    const updatedEntries = existingEntries.concat(entry);
    cloneMemory.set(userId, updatedEntries);

    // Persist updated entries
    await saveCloneMemory(userId, updatedEntries);
    logger.debug(
      `📥 Clone memory for user ${userId} updated (total ${updatedEntries.length} entries)`
    );
  } catch (err) {
    logger.error(
      `⚠️ Failed to update clone memory for user ${userId}:`,
      err instanceof Error ? err.stack : err
    );
  }
}
