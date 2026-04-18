/**
 * @file src/utils/fileUtils.ts
 * @description Handles encryption, directory management, and generic data persistence for memory and conversations.
 */

import { CLONE_MEM_DIR, CONV_DIR, USER_MEM_DIR } from "@/config/paths.js";
import { ChatMessage, ConversationContext } from "@/types/chat.js";
import { GeneralMemoryEntry } from "@/types/memory.js";
import { getRequired } from "@/utils/env.js";
import logger from "@/utils/logger.js";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { existsSync } from "fs";
import fs from "fs/promises";
import { join } from "path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// Derived once at startup; avoids re-hashing on every encrypt/decrypt call
let _encKey: Buffer | undefined;

/**
 * Returns the cached AES-256 key, deriving it from the environment on first call.
 * @returns The 32-byte encryption key buffer.
 */
function getEncKey(): Buffer {
  if (!_encKey) {
    _encKey = createHash("sha256").update(getRequired("ENCRYPTION_KEY")).digest();
  }
  return _encKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * @param plain - The plaintext to encrypt.
 * @returns The encrypted string, encoded as base64.
 */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncKey(), iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
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
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const text = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getEncKey(), iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(text), decipher.final()]).toString("utf8");
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 * @param dir - The directory path to ensure.
 */
export async function ensureDir(dir: string): Promise<void> {
  try {
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
  } catch (err) {
    logger.error(`[fileUtils] Failed to ensure directory ${dir}:`, err);
  }
}

/**
 * Generic save of JSON-serializable data to a specified directory with encryption.
 * @param baseDir - The base directory for storage.
 * @param id - Identifier used as the filename (without extension).
 * @param data - The data to serialize and save.
 */
export async function saveData<T>(baseDir: string, id: string, data: T): Promise<void> {
  const filePath = join(baseDir, `${id}.json`);
  await ensureDir(baseDir);
  try {
    await fs.writeFile(filePath, encrypt(JSON.stringify(data)), "utf8");
  } catch (err) {
    logger.error(`[fileUtils] Failed to write file ${filePath}:`, err);
  }
}

/**
 * Generic load and decrypt of JSON-serialized data, returning a fallback if not found or on error.
 * @param baseDir - The base directory for storage.
 * @param id - Identifier used as the filename (without extension).
 * @param fallback - Value to return if the file is missing or parsing fails.
 * @returns The loaded data or the provided fallback.
 */
export async function loadData<T>(baseDir: string, id: string, fallback: T): Promise<T> {
  const filePath = join(baseDir, `${id}.json`);
  try {
    const enc = await fs.readFile(filePath, "utf8");
    return JSON.parse(decrypt(enc)) as T;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return fallback;
    logger.error(`[fileUtils] Failed to load data for id=${id}:`, err);
    if (
      err instanceof Error &&
      (err.message.includes("Unable to authenticate data") ||
        err.message.includes("Unsupported state"))
    ) {
      try {
        await fs.unlink(filePath);
        logger.warn(`[fileUtils] Deleted corrupt data file ${filePath}`);
      } catch (unlinkErr) {
        logger.error(`[fileUtils] Failed to delete corrupt file ${filePath}:`, unlinkErr);
      }
    }
    return fallback;
  }
}

/**
 * Persists user memory entries to disk.
 * @param uid - Discord user ID.
 * @param entries - Memory entries to save.
 * @returns Promise that resolves when the write completes.
 */
export const saveUserMemory = (uid: string, entries: GeneralMemoryEntry[]): Promise<void> =>
  saveData(USER_MEM_DIR, uid, entries);

/**
 * Loads user memory entries from disk.
 * @param uid - Discord user ID.
 * @returns Promise resolving to the saved entries, or an empty array if none exist.
 */
export const loadUserMemory = (uid: string): Promise<GeneralMemoryEntry[]> =>
  loadData(USER_MEM_DIR, uid, []);

/**
 * Persists clone memory entries to disk.
 * @param uid - Discord user ID.
 * @param entries - Memory entries to save.
 * @returns Promise that resolves when the write completes.
 */
export const saveCloneMemory = (uid: string, entries: GeneralMemoryEntry[]): Promise<void> =>
  saveData(CLONE_MEM_DIR, uid, entries);

/**
 * Loads clone memory entries from disk.
 * @param uid - Discord user ID.
 * @returns Promise resolving to the saved entries, or an empty array if none exist.
 */
export const loadCloneMemory = (uid: string): Promise<GeneralMemoryEntry[]> =>
  loadData(CLONE_MEM_DIR, uid, []);

/**
 * Save all conversation threads for contexts to disk.
 * @param histories - Map of context keys to conversation contexts.
 * @param idMaps - Map of context keys to message ID mappings.
 */
export async function saveConversations(
  histories: Map<string, Map<string, ConversationContext>>,
  idMaps: Map<string, Map<string, string>>,
): Promise<void> {
  for (const [ctx, convs] of histories.entries()) {
    const out: Record<string, ChatMessage[]> = {};
    const map = idMaps.get(ctx)!;
    for (const [msgId, thread] of convs.entries()) {
      out[map.get(msgId)!] = Array.from(thread.messages.values());
    }
    await saveData(CONV_DIR, ctx, out);
  }
}

/**
 * Load all conversation threads for a given context key into memory maps.
 * @param ctx - Context key (guild or direct message key).
 * @param histories - Map to populate with conversation contexts.
 * @param idMaps - Map to populate with ID mappings.
 */
export async function loadConversations(
  ctx: string,
  histories: Map<string, Map<string, ConversationContext>>,
  idMaps: Map<string, Map<string, string>>,
): Promise<void> {
  let raw: Record<string, ChatMessage[]> = {};
  try {
    raw = await loadData(CONV_DIR, ctx, {});
  } catch (err) {
    logger.error(`[fileUtils] Failed to load conversations for context ${ctx}:`, err);
  }
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
