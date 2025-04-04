import { GeneralMemoryEntry } from "../types/types.js";
import {
  loadGeneralMemoryForGuild,
  saveGeneralMemoryForGuild,
} from "../utils/fileUtils.js";
import logger from "../utils/logger.js";

// In-memory storage for general (guild) memory entries.
export const generalMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Initializes the general memory by clearing any existing entries.
 */
export async function initializeGeneralMemory(): Promise<void> {
  generalMemory.clear();
}

/**
 * Updates the general memory for a given guild by adding a new entry,
 * then persists the updated memory to disk.
 *
 * @param guildId - The ID of the guild.
 * @param entry - The new memory entry to add.
 */
export async function updateGeneralMemory(
  guildId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    const existingEntries =
      generalMemory.get(guildId) ??
      (await loadGeneralMemoryForGuild(guildId)) ??
      [];
    const updatedEntries = [...existingEntries, entry];
    generalMemory.set(guildId, updatedEntries);
    await saveGeneralMemoryForGuild(guildId, updatedEntries);
  } catch (error) {
    logger.error(
      `Failed to update general memory for guild ${guildId}:`,
      error
    );
  }
}
