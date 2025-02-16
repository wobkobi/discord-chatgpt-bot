import { GeneralMemoryEntry } from "../types/types.js";
import { loadUserMemory, saveUserMemory } from "../utils/fileUtils.js";

export let userMemory = new Map<string, GeneralMemoryEntry[]>();

export async function initializeUserMemory(): Promise<void> {
  // Optionally, you could scan USER_MEMORY_DIRECTORY to preload memory.
  userMemory = new Map();
}

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
