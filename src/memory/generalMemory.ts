import { GeneralMemoryEntry } from "../types/types.js";
import {
  loadGeneralMemoryForGuild,
  saveGeneralMemoryForGuild,
} from "../utils/fileUtils.js";

export const generalMemory = new Map<string, GeneralMemoryEntry[]>();

export async function initializeGeneralMemory(): Promise<void> {
  generalMemory.clear();
}

export async function updateGeneralMemory(
  guildId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  try {
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
