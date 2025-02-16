import { existsSync, promises as fsPromises } from "fs";
import { join } from "path";
import { GeneralMemoryEntry } from "../types/types.js";
import { decrypt, encrypt, ensureDirectoryExists } from "../utils/fileUtils.js";

// Directory for storing global memory data.
const MEMORY_DIR = join(process.cwd(), "data");
// File that stores the global memory.
const GLOBAL_MEMORY_FILE = join(MEMORY_DIR, "globalMemory.bin");

// Global memory map: keyed by user ID, value is an array of memory entries.
export let globalMemory = new Map<string, GeneralMemoryEntry[]>();

/**
 * Loads the global memory from disk. If the file doesn't exist, initializes an empty map.
 */
export async function initializeGlobalMemory(): Promise<void> {
  await ensureDirectoryExists(MEMORY_DIR);
  if (existsSync(GLOBAL_MEMORY_FILE)) {
    try {
      const encryptedData = await fsPromises.readFile(
        GLOBAL_MEMORY_FILE,
        "utf-8"
      );
      const decrypted = decrypt(encryptedData);
      const data: [string, GeneralMemoryEntry[]][] = JSON.parse(decrypted);
      globalMemory = new Map(data);
      console.log("Global memory loaded successfully.");
    } catch (err) {
      console.error("Error loading global memory:", err);
      globalMemory = new Map();
    }
  } else {
    globalMemory = new Map();
  }
}

/**
 * Updates the global memory for a given user ID by adding a new entry,
 * then persists the updated memory to disk.
 * @param userId - The Discord user ID.
 * @param entry - The memory entry to add.
 */
export async function updateGlobalMemory(
  userId: string,
  entry: GeneralMemoryEntry
): Promise<void> {
  const entries = globalMemory.get(userId) || [];
  entries.push(entry);
  globalMemory.set(userId, entries);
  await saveGlobalMemory();
}

/**
 * Saves the entire global memory map to disk in encrypted form.
 */
async function saveGlobalMemory(): Promise<void> {
  const data = JSON.stringify(Array.from(globalMemory.entries()));
  const encrypted = encrypt(data);
  await fsPromises.writeFile(GLOBAL_MEMORY_FILE, encrypted, "utf-8");
}
