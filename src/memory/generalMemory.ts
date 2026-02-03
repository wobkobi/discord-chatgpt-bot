import type { GeneralMemoryEntry } from "../types/types.js";
import {
  loadGeneralMemoryForGuild,
  saveGeneralMemoryForGuild,
} from "../utils/fileUtils.js";

/**
 * In-memory cache of guild-scoped memory entries keyed by guild ID.
 */
export let generalMemory: Map<string, GeneralMemoryEntry[]> = new Map<
  string,
  GeneralMemoryEntry[]
>();

/**
 * Initialises the in-memory general memory cache.
 * Optionally, you can preload memory from disk here.
 * @returns Resolves when the cache has been initialised.
 */
export async function initializeGeneralMemory(): Promise<void> {
  generalMemory = new Map<string, GeneralMemoryEntry[]>();
}

/**
 * Adds a memory entry for a guild, updates the in-memory cache, and persists it to disk.
 * @param guildId - The guild ID to associate with the memory entry.
 * @param entry - The memory entry to append for the guild.
 * @returns Resolves once the entry has been appended and persisted.
 */
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
