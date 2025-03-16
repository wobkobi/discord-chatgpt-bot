// cloneMemory.ts
import { GeneralMemoryEntry } from "../types/types.js";
import { loadCloneMemory, saveCloneMemory } from "../utils/fileUtils.js";

export const cloneMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Initializes the clone memory map.
 */
export async function initializeCloneMemory(): Promise<void> {
  cloneMemory.clear();
}

/**
 * Updates clone memory.
 * Adds additional context (timestamp and, optionally, interaction info) to the memory entry
 * so the model can learn how others interact with the cloned user.
 *
 * @param cloneUserId - The cloned user's ID.
 * @param entry - The memory entry to record.
 * @param interactingUserId - (Optional) The ID of the user interacting with the clone.
 */
export async function updateCloneMemory(
  cloneUserId: string,
  entry: GeneralMemoryEntry,
  interactingUserId?: string
): Promise<void> {
  try {
    // Prepare extra context if an interacting user is provided.
    let additionalContext = "";
    if (interactingUserId) {
      additionalContext = `Interacted by <@${interactingUserId}>: `;
    }
    // Prepend the timestamp and any interaction context to the entry's content.
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
