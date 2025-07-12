/**
 * @file src/memory/cloneMemory.ts
 * @description Manages the clone memory store: logs interactions for the cloned user persona and persists them to disk.
 *
 *   Provides in-memory caching and persistence for clone-specific conversation memory.
 *   Uses debug logging to trace loads, updates, and saves.
 */

import { GeneralMemoryEntry } from "@/types";
import { loadCloneMemory, saveCloneMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";
import { trimMemory } from "../utils/trimMemory.js";

// In-memory cache of clone memory entries, keyed by Discord user ID.
export const cloneMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Clears and initialises the in-memory clone memory cache.
 * @async
 * @returns Promise that resolves once the cache has been cleared.
 */
export async function initialiseCloneMemory(): Promise<void> {
  logger.debug("[cloneMemory] initialiseCloneMemory invoked");
  cloneMemory.clear();
  logger.info("🗂️ Clone memory cache cleared");
  logger.debug("[cloneMemory] Cache is now empty");
}

/**
 * Appends a new memory entry for the clone persona, updates the cache, and persists to disk.
 * @async
 * @param userId - Discord user ID for which to update the clone memory.
 * @param entry - The memory entry to append, containing timestamp and content.
 * @returns Promise that resolves when the memory has been successfully updated.
 */
export async function updateCloneMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  logger.debug(
    `[cloneMemory] updateCloneMemory invoked for userId=${userId}, timestamp=${entry.timestamp}`
  );
  try {
    logger.debug(`[cloneMemory] Loading existing entries for userId=${userId}`);
    const existingEntries = await loadCloneMemory(userId);
    logger.debug(
      `[cloneMemory] Retrieved ${existingEntries.length} existing entries`
    );

    const updatedEntries = existingEntries.concat(entry);
    const trimmedEntries = trimMemory(updatedEntries);
    cloneMemory.set(userId, updatedEntries);
    logger.debug(
      `[cloneMemory] Cache updated for userId=${userId}, total entries=${updatedEntries.length}`
    );

    logger.debug(
      `[cloneMemory] Persisting ${updatedEntries.length} entries for userId=${userId}`
    );
    await saveCloneMemory(userId, trimmedEntries);
    logger.info(`📥 Clone memory persisted for user ${userId}`);
  } catch (err) {
    logger.error(
      `[cloneMemory] Failed to update clone memory for user ${userId}:`,
      err instanceof Error ? err.stack : err
    );
  }
}
