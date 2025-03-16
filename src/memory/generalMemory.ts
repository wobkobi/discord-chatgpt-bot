import { GeneralMemoryEntry } from "../types/types.js";
import {
  loadGeneralMemoryForGuild,
  saveGeneralMemoryForGuild,
} from "../utils/fileUtils.js";

export const generalMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Initializes the general (guild) memory map.
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
 * (Additional formatting can be applied here if referencing users within the guild context.)
 */
export async function updateGeneralMemory(
  guildId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
    // For now, we simply pass the entry through; you can extend this to format user references if needed.
    const formattedEntry: GeneralMemoryEntry = {
      ...entry,
      content: entry.content,
    };
    const existingEntries =
      generalMemory.get(guildId) ??
      (await loadGeneralMemoryForGuild(guildId)) ??
      [];
    const updatedEntries = [...existingEntries, formattedEntry];
    generalMemory.set(guildId, updatedEntries);
    await saveGeneralMemoryForGuild(guildId, updatedEntries);
  } catch (error) {
    console.error(
      `Failed to update general memory for guild ${guildId}:`,
      error
    );
  }
}
