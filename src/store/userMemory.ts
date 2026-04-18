/**
 * @file src/store/userMemory.ts
 * @description Manages long-term memory entries for regular users, stored in-memory and persisted to disk.
 */

import { GeneralMemoryEntry } from "@/types/memory.js";
import { loadUserMemory, saveUserMemory } from "@/utils/fileUtils.js";
import logger from "@/utils/logger.js";
import { trimMemory } from "@/utils/trimMemory.js";

/** In-memory cache of user memory entries, keyed by Discord user ID. */
export const userMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Clears and initialises the in-memory user memory cache.
 * @returns Promise that resolves once the cache has been cleared.
 */
export async function initialiseUserMemory(): Promise<void> {
  userMemory.clear();
  logger.info("🗂️  User memory cache cleared");
}

/**
 * Appends a new memory entry for a user, trims to the size cap, updates the cache, and persists to disk.
 * @param userId - Discord user ID for whom to store the memory entry.
 * @param entry - The memory entry to append, containing timestamp and content.
 * @returns Promise that resolves once the memory has been saved.
 */
export async function updateUserMemory(userId: string, entry: GeneralMemoryEntry): Promise<void> {
  try {
    const existing = userMemory.get(userId) ?? (await loadUserMemory(userId));
    const trimmed = trimMemory(existing.concat(entry));
    userMemory.set(userId, trimmed);
    await saveUserMemory(userId, trimmed);
    logger.info(`📥 User memory persisted for user ${userId}`);
  } catch (err) {
    logger.error(
      `[userMemory] Failed to update memory for userId=${userId}:`,
      err instanceof Error ? err.stack : err,
    );
  }
}
