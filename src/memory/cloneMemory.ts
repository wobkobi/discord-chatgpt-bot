import { GeneralMemoryEntry } from "../types/types.js";
import { loadCloneMemory, saveCloneMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

/** In‑memory storage for clone memory entries. */
export const cloneMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Initializes the clone memory by clearing any existing entries.
 */
export async function initializeCloneMemory(): Promise<void> {
  cloneMemory.clear();
}

/**
 * Updates the clone memory for a given user by appending a new memory entry,
 * then persists the updated memory to disk.
 *
 * @param userId - The ID of the clone user.
 * @param entry - The new memory entry.
 */
export async function updateCloneMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    const existingEntries: GeneralMemoryEntry[] =
      cloneMemory.get(userId) ?? (await loadCloneMemory(userId)) ?? [];
    const updatedEntries = [...existingEntries, entry];
    cloneMemory.set(userId, updatedEntries);
    await saveCloneMemory(userId, updatedEntries);
  } catch (error) {
    logger.error(`Failed to update clone memory for user ${userId}:`, error);
  }
}
