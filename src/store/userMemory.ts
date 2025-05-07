/**
 * @file src/memory/userMemory.ts
 * @description Manages long-term memory entries for regular users, stored in-memory and persisted to disk.
 * @remarks
 *   Provides fast in-memory access and persists to a JSON store to survive restarts.
 *   Uses debug logging for tracing load, clear, update, and save operations.
 */

import { GeneralMemoryEntry } from "@/types";
import { loadUserMemory, saveUserMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/**
 * In-memory cache of user memory entries, keyed by Discord user ID.
 */
export const userMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Clears and initialises the in-memory user memory cache.
 *
 * @async
 * @returns Promise<void> that resolves once the cache has been cleared.
 */
export async function initialiseUserMemory(): Promise<void> {
  logger.debug("[userMemory] initialiseUserMemory invoked");
  userMemory.clear();
  logger.info("🗂️ User memory cache cleared");
}

/**
 * Append a new memory entry for a user, update the in-memory cache, and persist to disk.
 * Prevents duplicate consecutive entries.
 *
 * @async
 * @param userId - Discord user ID for whom to store the memory entry.
 * @param entry - The memory entry to append, containing timestamp and content.
 * @returns Promise<void> that resolves once the memory has been saved.
 */
export async function updateUserMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  logger.debug(
    `[userMemory] updateUserMemory invoked for userId=${userId}, timestamp=${entry.timestamp}`
  );
  try {
    // Load existing entries from disk (or empty array if none)
    logger.debug(`[userMemory] Loading existing entries for userId=${userId}`);
    const existingEntries = await loadUserMemory(userId);

    // Skip if identical to the last entry
    const last = existingEntries[existingEntries.length - 1];
    if (last && last.content === entry.content) {
      logger.debug(
        `[userMemory] 🔁 Duplicate memory entry for ${userId}; skipping save`
      );
      return;
    }

    // Append the new entry to the cache
    const updatedEntries = existingEntries.concat(entry);
    userMemory.set(userId, updatedEntries);

    // Persist the updated entries to disk
    await saveUserMemory(userId, updatedEntries);
    logger.debug(
      `[userMemory] 📥 User memory for ${userId} updated (total ${updatedEntries.length} entries)`
    );
  } catch (err) {
    logger.error(
      `[userMemory] ⚠️ Failed to update user memory for ${userId}:`,
      err instanceof Error ? err.stack : err
    );
  }
}
