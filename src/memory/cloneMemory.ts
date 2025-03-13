// memory/cloneMemory.ts
import { GeneralMemoryEntry } from "../types/types.js";
import { loadCloneMemory, saveCloneMemory } from "../utils/fileUtils.js";

export const cloneMemory = new Map<string, GeneralMemoryEntry[]>();

export async function initializeCloneMemory(): Promise<void> {
  cloneMemory.clear();
}

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
    console.error(`Failed to update clone memory for user ${userId}:`, error);
  }
}
