import { GeneralMemoryEntry } from "../types/types.js";
import { loadUserMemory, saveUserMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/** In‑memory storage for individual user memory entries. */
export const userMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Initializes the user memory by clearing any existing entries.
 */
export async function initializeUserMemory(): Promise<void> {
  userMemory.clear();
}

/**
 * Updates the memory for a specific user by appending a new memory entry,
 * then persists the updated memory to disk.
 *
 * @param userId - The ID of the user.
 * @param entry - The new memory entry.
 */
export async function updateUserMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    const existingEntries: GeneralMemoryEntry[] =
      userMemory.get(userId) ?? (await loadUserMemory(userId)) ?? [];
    const updatedEntries = [...existingEntries, entry];
    userMemory.set(userId, updatedEntries);
    await saveUserMemory(userId, updatedEntries);
  } catch (error) {
    logger.error(`Failed to update user memory for user ${userId}:`, error);
  }
}
