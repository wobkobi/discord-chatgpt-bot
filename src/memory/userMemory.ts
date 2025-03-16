import { GeneralMemoryEntry } from "../types/types.js";
import { loadUserMemory, saveUserMemory } from "../utils/fileUtils.js";

export const userMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Initializes the user memory map.
 */
export async function initializeUserMemory(): Promise<void> {
  // Clear any existing user memory.
  userMemory.clear();
  // Optionally, preload memory from disk here.
}

/**
 * Updates user memory.
 * Retrieves stored entries from the in-memory cache (or loads from disk if not present),
 * adds the new entry (with the user mentioned in the content), updates the cache, and then saves to disk.
 */
export async function updateUserMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    // Format the entry so that it clearly shows who asked the question using a proper mention.
    const formattedEntry: GeneralMemoryEntry = {
      ...entry,
      content: `<@${userId}>: ${entry.content}`,
    };
    const existingEntries =
      userMemory.get(userId) ?? (await loadUserMemory(userId)) ?? [];
    const updatedEntries = [...existingEntries, formattedEntry];
    userMemory.set(userId, updatedEntries);
    await saveUserMemory(userId, updatedEntries);
  } catch (error) {
    console.error(`Failed to update user memory for user ${userId}:`, error);
  }
}
