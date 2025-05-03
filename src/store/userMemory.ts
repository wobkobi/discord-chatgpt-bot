/**
 * @file src/memory/userMemory.ts
 * @description Manages long-term memory entries for regular users, stored in-memory and persisted to disk.
 * @remarks
 *   Memory is cached for fast access and saved to a JSON store to survive restarts.
 */

import { GeneralMemoryEntry } from "@/types";
import { loadUserMemory, saveUserMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/**
 * In-memory cache of user memory entries, keyed by Discord user ID.
 */
export const userMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Initialise the in-memory user memory cache by clearing all entries.
 *
 * @async
 * @returns A promise that resolves once the cache has been cleared.
 */
export async function initialiseUserMemory(): Promise<void> {
  userMemory.clear();
  logger.info("🗂️ User memory cache cleared");
}

/**
 * Append a new memory entry for a user, update the in-memory cache, and persist to disk.
 *
 * @async
 * @param userId - Discord user ID for whom to store the memory entry.
 * @param entry - The memory entry to append, containing timestamp and content.
 * @returns A promise that resolves when the memory has been saved.
 */
export async function updateUserMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    // Load existing entries from disk (or empty array if none)
    const existingEntries = await loadUserMemory(userId);

    // Append the new entry to the cache
    const updatedEntries = existingEntries.concat(entry);
    userMemory.set(userId, updatedEntries);

    // Persist the updated entries to disk
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
