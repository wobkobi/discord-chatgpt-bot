/**
 * src/memory/userMemory.ts
 *
 * Manages per-user memory: conversation summaries and context,
 * kept in an in-memory cache and persisted to disk.
 */

import { GeneralMemoryEntry } from "@/types";
import { loadUserMemory, saveUserMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/**
 * In-memory cache of user memory entries, keyed by user ID.
 */
export const userMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Clears the in-memory cache for user memories.
 * Should be invoked at bot startup to reset state.
 */
export async function initialiseUserMemory(): Promise<void> {
  userMemory.clear();
  logger.info("🗂️ User memory cache cleared");
}

/**
 * Appends a new memory entry for the given user,
 * updates the in-memory cache, and persists all entries to disk.
 *
 * @param userId - The Discord user ID
 * @param entry  - The memory entry to store
 */
export async function updateUserMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    // Load existing if present in cache, otherwise from disk
    const existing = userMemory.has(userId)
      ? userMemory.get(userId)!
      : await loadUserMemory(userId);

    const updated = existing.concat(entry);
    userMemory.set(userId, updated);

    // Persist to disk
    await saveUserMemory(userId, updated);
    logger.debug(
      `📥 User memory for ${userId} updated (now ${updated.length} entries)`
    );
  } catch (err) {
    logger.error(
      `⚠️ Failed to update user memory for ${userId}:`,
      err instanceof Error ? err.stack : err
    );
  }
}
