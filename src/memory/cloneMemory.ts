/**
 * src/memory/cloneMemory.ts
 *
 * Manages the “clone” memory store: logs of interactions
 * specifically for the cloned user persona, persisted to disk.
 */

import { GeneralMemoryEntry } from "../types/types.js";
import { loadCloneMemory, saveCloneMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/**
 * In-memory cache of clone memory entries, keyed by user ID.
 */
export const cloneMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Clears the in-memory cache for clone memories.
 * Should be called at bot startup to reset state.
 */
export async function initialiseCloneMemory(): Promise<void> {
  cloneMemory.clear();
  logger.info("🗂️ Clone memory cache cleared");
}

/**
 * Appends a new memory entry for the given user,
 * updates the in-memory cache, and persists to disk.
 *
 * @param userId - The Discord user ID of the clone persona
 * @param entry  - The memory entry to store
 */
export async function updateCloneMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    // Load existing entries from cache or disk
    const existingEntries = cloneMemory.has(userId)
      ? cloneMemory.get(userId)!
      : await loadCloneMemory(userId);

    // Append the new entry
    const updatedEntries = existingEntries.concat(entry);
    cloneMemory.set(userId, updatedEntries);

    // Persist updated list
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
