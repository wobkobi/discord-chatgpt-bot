import { GeneralMemoryEntry } from "../types/types.js";
import { loadUserMemory, saveUserMemory } from "../utils/fileUtils.js";

export const userMemory = new Map<string, GeneralMemoryEntry[]>();

export async function initializeUserMemory(): Promise<void> {
  userMemory.clear();
}

export async function updateUserMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
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
