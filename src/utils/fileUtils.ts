/**
 * @file src/utils/fileUtils.ts
 * @description Handles encryption, directory management, and generic data persistence for memory and conversations.
 */

import { ChatMessage, ConversationContext, GeneralMemoryEntry } from "@/types";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import { existsSync } from "fs";
import fs from "fs/promises";
import { join } from "path";
import logger from "../utils/logger.js";

// Directories for persistence
const BASE_DIR = join(process.cwd(), "data");
const CONV_DIR = join(BASE_DIR, "conversations");
const USER_MEM_DIR = join(BASE_DIR, "memory", "user");
const CLONE_MEM_DIR = join(BASE_DIR, "memory", "clone");
const ERRORS_DIR = join(BASE_DIR, "errors");

// Encryption settings
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Encrypt a plaintext string using AES-256-GCM with a key derived from the environment.
 * @param plain - The plaintext to encrypt.
 * @returns The encrypted string, encoded as base64.
 */
export function encrypt(plain: string): string {
  const key = createHash("sha256")
    .update(process.env.ENCRYPTION_KEY ?? "")
    .digest();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext string back to plaintext.
 * @param enc - The encrypted string in base64.
 * @returns The decrypted plaintext.
 */
export function decrypt(enc: string): string {
  const data = Buffer.from(enc, "base64");
  const iv = data.slice(0, IV_LENGTH);
  const tag = data.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const text = data.slice(IV_LENGTH + TAG_LENGTH);
  const key = createHash("sha256")
    .update(process.env.ENCRYPTION_KEY ?? "")
    .digest();
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(text), decipher.final()]).toString(
    "utf8"
  );
}

/**
 * Ensures a directory exists, creating it recursively if needed.
 * @param dir - The directory path to ensure.
 */
export async function ensureDir(dir: string): Promise<void> {
  try {
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
  } catch (err) {
    logger.error(`Failed to ensure directory ${dir}:`, err);
  }
}

/**
 * Generic save of JSON-serializable data to a specified directory with encryption.
 * @param baseDir - The base directory for storage.
 * @param id - Identifier used as the filename (without extension).
 * @param data - The data to serialize and save.
 */
export async function saveData<T>(
  baseDir: string,
  id: string,
  data: T
): Promise<void> {
  const path = join(baseDir, `${id}.json`);
  await ensureDir(baseDir);
  const content = encrypt(JSON.stringify(data));
  await fs.writeFile(path, content, "utf8");
}

/**
 * Generic load and decrypt of JSON-serialized data, returning a fallback if not found or on error.
 * @param baseDir - The base directory for storage.
 * @param id - Identifier used as the filename (without extension).
 * @param fallback - Value to return if the file is missing or parsing fails.
 * @returns The loaded data or the provided fallback.
 */
export async function loadData<T>(
  baseDir: string,
  id: string,
  fallback: T
): Promise<T> {
  const path = join(baseDir, `${id}.json`);
  try {
    const enc = await fs.readFile(path, "utf8");
    const json = decrypt(enc);
    return JSON.parse(json) as T;
  } catch (err) {
    // Only log unexpected errors
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error(`Failed to load data ${id}:`, err);
    }
    return fallback;
  }
}

// Specific wrappers for memory
export const saveUserMemory = (
  uid: string,
  entries: GeneralMemoryEntry[]
): Promise<void> => saveData<GeneralMemoryEntry[]>(USER_MEM_DIR, uid, entries);

export const loadUserMemory = (uid: string): Promise<GeneralMemoryEntry[]> =>
  loadData<GeneralMemoryEntry[]>(USER_MEM_DIR, uid, []);

export const saveCloneMemory = (
  uid: string,
  entries: GeneralMemoryEntry[]
): Promise<void> => saveData<GeneralMemoryEntry[]>(CLONE_MEM_DIR, uid, entries);

export const loadCloneMemory = (uid: string): Promise<GeneralMemoryEntry[]> =>
  loadData<GeneralMemoryEntry[]>(CLONE_MEM_DIR, uid, []);

/**
 * Save all conversation threads for contexts to disk.
 * @param histories - Map of context keys to conversation threads.
 * @param idMaps - Map of context keys to message ID mappings.
 */
export async function saveConversations(
  histories: Map<string, Map<string, ConversationContext>>,
  idMaps: Map<string, Map<string, string>>
): Promise<void> {
  for (const [ctx, convs] of histories.entries()) {
    const out: Record<string, ChatMessage[]> = {};
    const map = idMaps.get(ctx)!;
    for (const [msgId, thread] of convs.entries()) {
      out[map.get(msgId)!] = Array.from(thread.messages.values());
    }
    await saveData<Record<string, ChatMessage[]>>(CONV_DIR, ctx, out);
  }
}

/**
 * Load all conversation threads for a given context key into memory maps.
 * @param ctx - Context key (guild or channel-user).
 * @param histories - Map to populate with conversation contexts.
 * @param idMaps - Map to populate with ID mappings.
 */
export async function loadConversations(
  ctx: string,
  histories: Map<string, Map<string, ConversationContext>>,
  idMaps: Map<string, Map<string, string>>
): Promise<void> {
  const raw = await loadData<Record<string, ChatMessage[]>>(
    CONV_DIR,
    ctx,
    {} as Record<string, ChatMessage[]>
  );
  const convMap = new Map<string, ConversationContext>();
  const idMap = new Map<string, string>();
  for (const [threadId, msgs] of Object.entries(raw)) {
    const convo: ConversationContext = { messages: new Map() };
    for (const msg of msgs) {
      convo.messages.set(msg.id, msg);
      idMap.set(msg.id, threadId);
    }
    convMap.set(threadId, convo);
  }
  histories.set(ctx, convMap);
  idMaps.set(ctx, idMap);
}

/**
 * Asynchronously log an error to a daily file in the errors directory.
 * @param err - The error object or message to log.
 */
export async function logErrorToFile(err: unknown): Promise<void> {
  try {
    await ensureDir(ERRORS_DIR);
    const date = new Date().toISOString().slice(0, 10);
    const path = join(ERRORS_DIR, `error-${date}.log`);
    const line = `${new Date().toISOString()} - ${err instanceof Error ? err.stack : String(err)}\n`;
    await fs.appendFile(path, line, "utf8");
  } catch (fsErr) {
    logger.error("Failed to write to error log:", fsErr);
  }
}
