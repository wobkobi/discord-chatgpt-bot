/**
 * @file src/memory/userMemory.ts
 * @description Manages long-term memory entries for regular users, stored in-memory and persisted to disk.
 *
 *   Provides fast in-memory access and persists to a JSON store to survive restarts.
 *   Uses debug logging for tracing load, clear, update, and save operations.
 */

import { GeneralMemoryEntry } from "@/types/memory.js";
import { loadUserMemory, saveUserMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";
import { trimMemory } from "../utils/trimMemory.js";

// In-memory cache of user memory entries, keyed by Discord user ID.
export const userMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Clears and initialises the in-memory user memory cache.
 * @async
 * @returns Promise<void> that resolves once the cache has been cleared.
 */
export async function initialiseUserMemory(): Promise<void> {
  logger.debug("[userMemory] initialiseUserMemory invoked");
  userMemory.clear();
  logger.info("🗂️  User memory cache cleared");
}

/**
 * Appends a new memory entry for a user, updates the in-memory cache, and persists to disk.
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
    logger.debug(`[userMemory] Loading existing entries for userId=${userId}`);
    const existingEntries = await loadUserMemory(userId);
    logger.debug(
      `[userMemory] Retrieved ${existingEntries.length} existing entries`
    );

    const updatedEntries = existingEntries.concat(entry);
    const trimmedEntries = trimMemory(updatedEntries);
    userMemory.set(userId, updatedEntries);
    logger.debug(
      `[userMemory] Cache updated for userId=${userId}, total entries=${updatedEntries.length}`
    );

    logger.debug(
      `[userMemory] Persisting ${updatedEntries.length} entries for userId=${userId}`
    );
    await saveUserMemory(userId, trimmedEntries);
    logger.info(`📥 User memory persisted for user ${userId}`);
  } catch (err) {
    logger.error(
      `[userMemory] Failed to update user memory for userId=${userId}:`,
      err instanceof Error ? err.stack : err
    );
  }
}
