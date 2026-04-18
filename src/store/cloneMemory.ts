/**
 * @file src/store/cloneMemory.ts
 * @description Manages the clone memory store: logs interactions for the cloned user persona and persists them to disk.
 */

import { GeneralMemoryEntry } from "@/types/memory.js";
import { loadCloneMemory, saveCloneMemory } from "@/utils/fileUtils.js";
import logger from "@/utils/logger.js";
import { trimMemory } from "@/utils/trimMemory.js";

/** In-memory cache of clone memory entries, keyed by Discord user ID. */
export const cloneMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Clears and initialises the in-memory clone memory cache.
 * @returns Promise that resolves once the cache has been cleared.
 */
export async function initialiseCloneMemory(): Promise<void> {
  cloneMemory.clear();
  logger.info("🗂️ Clone memory cache cleared");
}

/**
 * Appends a new memory entry for the clone persona, trims to the size cap, updates the cache, and persists to disk.
 * @param userId - Discord user ID for which to update the clone memory.
 * @param entry - The memory entry to append, containing timestamp and content.
 * @returns Promise that resolves when the memory has been successfully updated.
 */
export async function updateCloneMemory(userId: string, entry: GeneralMemoryEntry): Promise<void> {
  try {
    const existing = cloneMemory.get(userId) ?? (await loadCloneMemory(userId));
    const trimmed = trimMemory(existing.concat(entry));
    cloneMemory.set(userId, trimmed);
    await saveCloneMemory(userId, trimmed);
    logger.info(`📥 Clone memory persisted for user ${userId}`);
  } catch (err) {
    logger.error(
      `[cloneMemory] Failed to update memory for userId=${userId}:`,
      err instanceof Error ? err.stack : err,
    );
  }
}
