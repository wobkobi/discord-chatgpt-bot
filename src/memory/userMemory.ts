import type { GeneralMemoryEntry } from "../types/types.js";
import { loadUserMemory, saveUserMemory } from "../utils/fileUtils.js";

/**
 * In-memory cache of user-scoped memory entries keyed by user ID.
 */
export let userMemory: Map<string, GeneralMemoryEntry[]> = new Map<
  string,
  GeneralMemoryEntry[]
>();

/**
 * Initialises the in-memory user memory cache.
 * Optionally, you could scan the user memory directory and preload entries.
 * @returns Resolves when the cache has been initialised.
 */
export async function initializeUserMemory(): Promise<void> {
  userMemory = new Map<string, GeneralMemoryEntry[]>();
}

/**
 * Adds a memory entry for a user, updates the in-memory cache, and persists it to disk.
 * @param userId - The user ID to associate with the memory entry.
 * @param entry - The memory entry to append for the user.
 * @returns Resolves once the entry has been appended and persisted.
 */
export async function updateUserMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  let entries = userMemory.get(userId);

  if (!entries) {
    entries = await loadUserMemory(userId);
  }

  entries.push(entry);
  userMemory.set(userId, entries);

  await saveUserMemory(userId, entries);
}
