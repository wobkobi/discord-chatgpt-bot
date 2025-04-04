import { GeneralMemoryEntry } from "../types/types.js";
import { loadCloneMemory, saveCloneMemory } from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

// In-memory storage for clone memory entries.
export const cloneMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Initializes the clone memory by clearing any existing entries.
 */
export async function initializeCloneMemory(): Promise<void> {
  cloneMemory.clear();
}

/**
 * Updates the clone memory for a given user by adding a new entry and then
 * persisting the updated memory to disk.
 *
 * @param userId - The ID of the user.
 * @param entry - The new memory entry to add.
 */
export async function updateCloneMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    const entries =
      cloneMemory.get(userId) ?? (await loadCloneMemory(userId)) ?? [];
    const updatedEntries = [...entries, entry];
    cloneMemory.set(userId, updatedEntries);
    await saveCloneMemory(userId, updatedEntries);
  } catch (error) {
    logger.error(`Failed to update clone memory for user ${userId}:`, error);
  }
}
