import { GeneralMemoryEntry } from "../types/types.js";
import {
  loadGeneralMemoryForGuild,
  saveGeneralMemoryForGuild,
} from "../utils/fileUtils.js";

// Global store: maps guildId to an array of memory entries.
export let generalMemory = new Map<string, GeneralMemoryEntry[]>();

// Initialize general memory (for now, starting with an empty map).
export async function initializeGeneralMemory(): Promise<void> {
  generalMemory = new Map();
  // Optionally, you can scan the general memory directory here to preload guild memory.
}

// Update general memory for a guild by loading its file (if needed), appending the new entry, and saving it back.
export async function updateGeneralMemory(
  guildId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  let entries = generalMemory.get(guildId);
  if (!entries) {
    entries = await loadGeneralMemoryForGuild(guildId);
  }
  entries.push(entry);
  generalMemory.set(guildId, entries);
  await saveGeneralMemoryForGuild(guildId, entries);
}
