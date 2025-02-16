import { GeneralMemoryEntry } from "../types/types.js";
import {
  loadGeneralMemoryForGuild,
  saveGeneralMemoryForGuild,
} from "../utils/fileUtils.js";

export let generalMemory = new Map<string, GeneralMemoryEntry[]>();

export async function initializeGeneralMemory(): Promise<void> {
  // Optionally, preload memory here.
  generalMemory = new Map();
}

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
