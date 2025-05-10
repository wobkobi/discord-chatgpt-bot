/**
 * @file src/utils/fileUtils.ts
 * @description Handles encryption, directory management, and generic data persistence for memory and conversations.
 *
 *   Uses AES-256-GCM encryption for secure storage and manages JSON serialization in the configured data directories.
 *   Provides debug logging at each step via logger.debug to trace file operations and encryption flows.
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
import { CLONE_MEM_DIR, CONV_DIR, USER_MEM_DIR } from "../config/paths.js";
import logger from "../utils/logger.js";
import { getRequired } from "./env.js";

// Encryption settings
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

logger.debug("[fileUtils] Module loaded");

/**
 * Encrypt a plaintext string using AES-256-GCM with a key derived from the environment.
 * @param plain - The plaintext to encrypt.
 * @returns The encrypted string, encoded as base64.
 */
export function encrypt(plain: string): string {
  logger.debug(`[fileUtils] encrypt invoked, plaintext length=${plain.length}`);
  const key = createHash("sha256")
    .update(getRequired("ENCRYPTION_KEY"))
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
  const result = Buffer.concat([iv, tag, encrypted]).toString("base64");
  logger.debug(`[fileUtils] encrypt output length=${result.length} (base64)`);
  return result;
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext string back to plaintext.
 * @param enc - The encrypted string in base64.
 * @returns The decrypted plaintext.
 */
export function decrypt(enc: string): string {
  logger.debug(`[fileUtils] decrypt invoked, ciphertext length=${enc.length}`);
  const data = Buffer.from(enc, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const text = data.subarray(IV_LENGTH + TAG_LENGTH);
  const key = createHash("sha256")
    .update(getRequired("ENCRYPTION_KEY"))
    .digest();
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(text),
    decipher.final(),
  ]).toString("utf8");
  logger.debug(`[fileUtils] decrypt output length=${plaintext.length}`);
  return plaintext;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 * @param dir - The directory path to ensure.
 */
export async function ensureDir(dir: string): Promise<void> {
  logger.debug(`[fileUtils] ensureDir invoked for directory=${dir}`);
  try {
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
      logger.debug(`[fileUtils] Created directory=${dir}`);
    } else {
      logger.debug(`[fileUtils] Directory already exists: ${dir}`);
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
export async function saveData<T>(
  baseDir: string,
  id: string,
  data: T
): Promise<void> {
  const filePath = join(baseDir, `${id}.json`);
  logger.debug(
    `[fileUtils] saveData invoked for id=${id}, filePath=${filePath}`
  );
  await ensureDir(baseDir);
  const content = encrypt(JSON.stringify(data));
  logger.debug(`[fileUtils] Writing encrypted data to ${filePath}`);
  try {
    await fs.writeFile(filePath, content, "utf8");
    logger.debug(`[fileUtils] Successfully wrote file ${filePath}`);
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
export async function loadData<T>(
  baseDir: string,
  id: string,
  fallback: T
): Promise<T> {
  const filePath = join(baseDir, `${id}.json`);
  logger.debug(
    `[fileUtils] loadData invoked for id=${id}, filePath=${filePath}`
  );
  try {
    const enc = await fs.readFile(filePath, "utf8");
    logger.debug(`[fileUtils] Read encrypted file, length=${enc.length}`);
    const json = decrypt(enc);
    logger.debug(`[fileUtils] Decryption successful, parsing JSON`);
    return JSON.parse(json) as T;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      logger.debug(`[fileUtils] No data file for id=${id}; returning fallback`);
      return fallback;
    }
    logger.error(`[fileUtils] Failed to load data for id=${id}:`, err);
    // If decryption/authentication failed, remove the corrupt file
    if (
      err instanceof Error &&
      (err.message.includes("Unable to authenticate data") ||
        err.message.includes("Unsupported state"))
    ) {
      try {
        await fs.unlink(filePath);
        logger.warn(`[fileUtils] Deleted corrupt data file ${filePath}`);
      } catch (unlinkErr) {
        logger.error(
          `[fileUtils] Failed to delete corrupt file ${filePath}:`,
          unlinkErr
        );
      }
    }
    return fallback;
  }
}

// Specific wrappers for memory
export const saveUserMemory = (
  uid: string,
  entries: GeneralMemoryEntry[]
): Promise<void> => saveData(USER_MEM_DIR, uid, entries);

export const loadUserMemory = (uid: string): Promise<GeneralMemoryEntry[]> =>
  loadData(USER_MEM_DIR, uid, []);

export const saveCloneMemory = (
  uid: string,
  entries: GeneralMemoryEntry[]
): Promise<void> => saveData(CLONE_MEM_DIR, uid, entries);

export const loadCloneMemory = (uid: string): Promise<GeneralMemoryEntry[]> =>
  loadData(CLONE_MEM_DIR, uid, []);

/**
 * Save all conversation threads for contexts to disk.
 * @param histories - Map of context keys to conversation contexts.
 * @param idMaps - Map of context keys to message ID mappings.
 */
export async function saveConversations(
  histories: Map<string, Map<string, ConversationContext>>,
  idMaps: Map<string, Map<string, string>>
): Promise<void> {
  logger.debug(
    `[fileUtils] saveConversations invoked for contexts=${histories.size}`
  );
  for (const [ctx, convs] of histories.entries()) {
    logger.debug(
      `[fileUtils] Saving conversations for context=${ctx}, threads=${convs.size}`
    );
    const out: Record<string, ChatMessage[]> = {};
    const map = idMaps.get(ctx)!;
    for (const [msgId, thread] of convs.entries()) {
      out[map.get(msgId)!] = Array.from(thread.messages.values());
    }
    await saveData(CONV_DIR, ctx, out);
  }
  logger.debug("[fileUtils] saveConversations complete");
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
  idMaps: Map<string, Map<string, string>>
): Promise<void> {
  logger.debug(`[fileUtils] loadConversations invoked for context=${ctx}`);
  let raw: Record<string, ChatMessage[]> = {};
  try {
    raw = await loadData(CONV_DIR, ctx, {});
    logger.debug(
      `[fileUtils] Loaded ${Object.keys(raw).length} threads for context=${ctx}`
    );
  } catch (err) {
    logger.error(
      `[fileUtils] Failed to load conversations for context ${ctx}:`,
      err
    );
    raw = {};
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
  logger.debug(
    `[fileUtils] loadConversations populated histories and idMaps for context=${ctx}`
  );
}
