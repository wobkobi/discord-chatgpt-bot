/**
 * @file src/memory/cloneMemory.ts
 * @description Manages the clone memory store: logs of interactions specifically for the cloned user persona, persisted to disk.
 */

import { GeneralMemoryEntry } from "@/types";
import { loadCloneMemory, saveCloneMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/**
 * In-memory cache of clone memory entries, keyed by user ID.
 */
export const cloneMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Clears the in-memory clone memory cache.
 *
 * @async
 * @returns Promise that resolves when the cache is cleared.
 */
export async function initialiseCloneMemory(): Promise<void> {
  cloneMemory.clear();
  logger.info("🗂️ Clone memory cache cleared");
}

/**
 * Appends a new memory entry for the specified clone user, updates the cache, and persists to disk.
 *
 * @async
 * @param userId - Discord user ID of the clone persona.
 * @param entry - Memory entry to append.
 * @returns Promise that resolves when the memory is updated.
 */
export async function updateCloneMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    // Load existing entries from disk
    const existingEntries = await loadCloneMemory(userId);

    // Append the new entry to the cache
    const updatedEntries = existingEntries.concat(entry);
    cloneMemory.set(userId, updatedEntries);

    // Persist updated entries to disk
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
