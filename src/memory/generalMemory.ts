import { GeneralMemoryEntry } from "../types/types.js";
import {
  loadGeneralMemoryForGuild,
  saveGeneralMemoryForGuild,
} from "../utils/fileUtils.js";

export const generalMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Initializes the general memory map.
 */
export async function initializeGeneralMemory(): Promise<void> {
  // Clear any existing memory.
  generalMemory.clear();
  // Optionally, preload memory for known guilds here.
}

/**
 * Updates general (guild) memory.
 * Retrieves stored entries from the in-memory cache (or loads from disk if not present),
 * adds the new entry, updates the cache, and then saves to disk.
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
    console.error(
      `Failed to update general memory for guild ${guildId}:`,
      error
    );
  }
}
