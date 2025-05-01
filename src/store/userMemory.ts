/**
 * @file src/memory/userMemory.ts
 * @description Manages long-term memory entries for regular users, stored in-memory and persisted to disk.
 */

import { GeneralMemoryEntry } from "@/types";
import { loadUserMemory, saveUserMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/**
 * In-memory cache of user memory entries, keyed by user ID.
 */
export const userMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Clears the entire user memory cache.
 *
 * @async
 * @returns Promise that resolves when the cache has been cleared.
 */
export async function initialiseUserMemory(): Promise<void> {
  userMemory.clear();
  logger.info("🗂️ User memory cache cleared");
}

/**
 * Appends a new memory entry for the specified user, updates the cache, and persists to disk.
 *
 * @async
 * @param userId - Discord user ID for whom to store memory.
 * @param entry - Memory entry object containing timestamp and content.
 * @returns Promise that resolves when the memory is updated and saved.
 */
export async function updateUserMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    // Load existing entries for user from disk
    const existingEntries = await loadUserMemory(userId);

    // Append the new entry to the in-memory cache
    const updatedEntries = existingEntries.concat(entry);
    userMemory.set(userId, updatedEntries);

    // Persist updated entries to disk
    await saveUserMemory(userId, updatedEntries);
    logger.debug(
      `📥 User memory for ${userId} updated (total ${updatedEntries.length} entries)`
    );
  } catch (err) {
    logger.error(
      `⚠️ Failed to update user memory for ${userId}:`,
      err instanceof Error ? err.stack : err
    );
  }
}
