/**
 * fileUtils.ts
 *
 * Handles encryption/decryption, file and directory operations, and
 * persistent conversation/memory storage.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import {
  ChatMessage,
  ConversationContext,
  GeneralMemoryEntry,
} from "../types/types.js";
import logger from "./logger.js";

dotenv.config();

// Base directories for persistent data.
export const BASE_DATA_DIRECTORY = "./data";
export const CONVERSATIONS_DIRECTORY = join(
  BASE_DATA_DIRECTORY,
  "conversations"
);
export const GENERAL_MEMORY_DIRECTORY = join(
  BASE_DATA_DIRECTORY,
  "generalMemory"
);
export const USER_MEMORY_DIRECTORY = join(BASE_DATA_DIRECTORY, "userMemory");
export const CLONE_MEMORY_DIRECTORY = join(BASE_DATA_DIRECTORY, "cloneMemory");
export const ERRORS_DIRECTORY = join(BASE_DATA_DIRECTORY, "errors");

// Track updated conversation contexts.
const updatedContexts: Set<string> = new Set();

// Set up encryption.
const ENCRYPTION_KEY_BASE = process.env.ENCRYPTION_KEY_BASE || "";
if (!ENCRYPTION_KEY_BASE) {
  throw new Error("ENCRYPTION_KEY_BASE environment variable is required.");
}
const ENCRYPTION_KEY = createHash("sha256")
  .update(ENCRYPTION_KEY_BASE)
  .digest();
const IV_LENGTH = 16;

export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decrypt(text: string): string {
  const parts = text.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "Invalid encrypted text format. Expected 'iv:encryptedData:authTag'."
    );
  }
  const iv = Buffer.from(parts[0], "hex");
  const encryptedText = Buffer.from(parts[1], "hex");
  const authTag = Buffer.from(parts[2], "hex");
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

export async function ensureDirectoryExists(
  directoryPath: string
): Promise<void> {
  try {
    await fs.promises.access(directoryPath);
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      await fs.promises.mkdir(directoryPath, { recursive: true });
    } else {
      throw error;
    }
  }
}

export async function ensureFileExists(
  contextKeys: string[],
  conversationHistories: Map<string, Map<string, ConversationContext>>,
  conversationIdMap: Map<string, Map<string, string>>
): Promise<void> {
  await Promise.all(
    contextKeys.map((key) =>
      loadConversations(key, conversationHistories, conversationIdMap)
    )
  );
}

/**
 * Generic function to save memory entries to disk.
 */
export async function saveMemory(
  directory: string,
  id: string,
  entries: GeneralMemoryEntry[]
): Promise<void> {
  await ensureDirectoryExists(directory);
  const filePath = join(directory, `${id}.bin`);
  const data = JSON.stringify(entries);
  await writeFile(filePath, encrypt(data), "utf-8");
}

/**
 * Generic function to load memory entries from disk.
 */
export async function loadMemory(
  directory: string,
  id: string
): Promise<GeneralMemoryEntry[]> {
  await ensureDirectoryExists(directory);
  const filePath = join(directory, `${id}.bin`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const encryptedData = await fs.promises.readFile(filePath, "utf-8");
    const decrypted = decrypt(encryptedData);
    return JSON.parse(decrypted) as GeneralMemoryEntry[];
  } catch (error: unknown) {
    logger.error(`Error loading memory for ${id} from ${directory}:`, error);
    return [];
  }
}

// Specific memory functions.
export async function saveGeneralMemoryForGuild(
  guildId: string,
  entries: GeneralMemoryEntry[]
): Promise<void> {
  await saveMemory(GENERAL_MEMORY_DIRECTORY, guildId, entries);
}

export async function loadGeneralMemoryForGuild(
  guildId: string
): Promise<GeneralMemoryEntry[]> {
  return loadMemory(GENERAL_MEMORY_DIRECTORY, guildId);
}

export async function saveUserMemory(
  userId: string,
  entries: GeneralMemoryEntry[]
): Promise<void> {
  await saveMemory(USER_MEMORY_DIRECTORY, userId, entries);
}

export async function loadUserMemory(
  userId: string
): Promise<GeneralMemoryEntry[]> {
  return loadMemory(USER_MEMORY_DIRECTORY, userId);
}

export async function saveCloneMemory(
  userId: string,
  entries: GeneralMemoryEntry[]
): Promise<void> {
  await saveMemory(CLONE_MEMORY_DIRECTORY, userId, entries);
}

export async function loadCloneMemory(
  userId: string
): Promise<GeneralMemoryEntry[]> {
  return loadMemory(CLONE_MEMORY_DIRECTORY, userId);
}

/**
 * Saves conversation histories and ID mappings to disk.
 */
export async function saveConversations(
  conversationHistories: Map<string, Map<string, ConversationContext>>,
  conversationIdMap: Map<string, Map<string, string>>
): Promise<void> {
  try {
    await ensureDirectoryExists(CONVERSATIONS_DIRECTORY);
    for (const contextKey of updatedContexts) {
      const histories = conversationHistories.get(contextKey);
      const idMap = conversationIdMap.get(contextKey);
      if (histories && idMap) {
        const dataPath = join(CONVERSATIONS_DIRECTORY, `${contextKey}.bin`);
        const idPath = join(CONVERSATIONS_DIRECTORY, `${contextKey}-idMap.bin`);
        const conversationsData = JSON.stringify(
          Array.from(histories.entries()).reduce<{
            [key: string]: { messages: [string, ChatMessage][] };
          }>((obj, [key, context]) => {
            obj[key] = { messages: Array.from(context.messages.entries()) };
            return obj;
          }, {})
        );
        const idMappingsData = JSON.stringify(Array.from(idMap.entries()));
        await Promise.all([
          writeFile(dataPath, encrypt(conversationsData), "utf-8"),
          writeFile(idPath, encrypt(idMappingsData), "utf-8"),
        ]);
      }
    }
    updatedContexts.clear();
  } catch (error: unknown) {
    saveErrorToFile(error);
  }
}

/**
 * Loads conversation histories and ID mappings from disk.
 */
export async function loadConversations(
  contextKey: string,
  conversationHistories: Map<string, Map<string, ConversationContext>>,
  conversationIdMap: Map<string, Map<string, string>>
): Promise<void> {
  const dataPath = join(CONVERSATIONS_DIRECTORY, `${contextKey}.bin`);
  const idPath = join(CONVERSATIONS_DIRECTORY, `${contextKey}-idMap.bin`);
  if (!fs.existsSync(dataPath) || !fs.existsSync(idPath)) {
    conversationHistories.set(contextKey, new Map());
    conversationIdMap.set(contextKey, new Map());
    return;
  }
  try {
    const convData = JSON.parse(
      decrypt(await fs.promises.readFile(dataPath, "utf-8"))
    );
    const idMapData: [string, string][] = JSON.parse(
      decrypt(await fs.promises.readFile(idPath, "utf-8"))
    );
    const newConversationMap = new Map<string, ConversationContext>();
    Object.entries(convData).forEach(([key, value]) => {
      const context = value as { messages: [string, ChatMessage][] };
      if (context.messages) {
        newConversationMap.set(key, { messages: new Map(context.messages) });
      }
    });
    conversationHistories.set(contextKey, newConversationMap);
    conversationIdMap.set(contextKey, new Map(idMapData));
  } catch (error: unknown) {
    saveErrorToFile(error);
    throw error;
  }
}

export function markContextAsUpdated(contextKey: string): void {
  updatedContexts.add(contextKey);
}

/**
 * Logs errors to a file.
 */
export function saveErrorToFile(error: unknown): void {
  const folder = ERRORS_DIRECTORY;
  ensureDirectoryExists(folder);
  const currentDate = new Date().toISOString().split("T")[0];
  const errorLogPath = join(folder, `error-${currentDate}.log`);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  const errorMessage = `${new Date().toISOString()} - ${
    error instanceof Error ? error.stack : String(error)
  }\n`;
  fs.appendFile(
    errorLogPath,
    errorMessage,
    (err: NodeJS.ErrnoException | null) => {
      if (err) {
        logger.error("Failed to write error to file:", err);
      }
    }
  );
}
