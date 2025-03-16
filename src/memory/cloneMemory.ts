import { GeneralMemoryEntry } from "../types/types.js";
import { loadCloneMemory, saveCloneMemory } from "../utils/fileUtils.js";

export const cloneMemory = new Map<string, GeneralMemoryEntry[]>();

export async function initializeCloneMemory(): Promise<void> {
  cloneMemory.clear();
}

/**
 * Updates clone memory by adding additional context about interactions.
 * @param cloneUserId - The cloned user's ID.
 * @param entry - The memory entry.
 * @param interactingUserId - (Optional) The ID of the user interacting with the clone.
 */
export async function updateCloneMemory(
  cloneUserId: string,
  entry: GeneralMemoryEntry,
  interactingUserId?: string
): Promise<void> {
  try {
    let additionalContext = "";
    if (interactingUserId) {
      additionalContext = `Interacted by <@${interactingUserId}>: `;
    }
    const formattedEntry: GeneralMemoryEntry = {
      ...entry,
      content: `${new Date(entry.timestamp).toISOString()} - ${additionalContext}${entry.content}`,
    };
    const entries =
      cloneMemory.get(cloneUserId) ??
      (await loadCloneMemory(cloneUserId)) ??
      [];
    const updatedEntries = [...entries, formattedEntry];
    cloneMemory.set(cloneUserId, updatedEntries);
    await saveCloneMemory(cloneUserId, updatedEntries);
  } catch (error) {
    console.error(
      `Failed to update clone memory for user ${cloneUserId}:`,
      error
    );
  }
}
