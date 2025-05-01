/**
 * fileUtils.ts
 *
 * - Encrypts/decrypts strings for on‐disk storage (AES-256-GCM).
 * - Ensures directories & files exist.
 * - Persists conversation contexts and memory blobs.
 * - Centralised, asynchronous error logging.
 */

import { ChatMessage, ConversationContext, GeneralMemoryEntry } from "@/types";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import dotenv from "dotenv";
import { existsSync } from "fs";
import fs from "fs/promises";
import { join, resolve } from "path";
import logger from "./logger.js";

dotenv.config();

// Base data directories (resolve to absolute paths)
const DATA_DIR = resolve(process.cwd(), "data");
const CONVERSATIONS_DIR = join(DATA_DIR, "conversations");
const GENERAL_MEM_DIR = join(DATA_DIR, "generalMemory");
const USER_MEM_DIR = join(DATA_DIR, "userMemory");
const CLONE_MEM_DIR = join(DATA_DIR, "cloneMemory");
const ERRORS_DIR = join(DATA_DIR, "errors");

// Track which conversation contexts have changed
const updatedConversationContexts = new Set<string>();

// AES-256-GCM setup
const KEY_BASE = process.env.ENCRYPTION_KEY_BASE;
if (!KEY_BASE) {
  throw new Error("ENCRYPTION_KEY_BASE env var is required");
}
const KEY = createHash("sha256").update(KEY_BASE).digest();
const IV_LENGTH = 16;

/** Encrypt a UTF-8 string into iv:ciphertext:authTag (hex) */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
}

/** Decrypt a hex iv:ciphertext:authTag string back to UTF-8 */
export function decrypt(enc: string): string {
  const [ivHex, ctHex, tagHex] = enc.split(":");
  if (!ivHex || !ctHex || !tagHex) {
    throw new Error("Invalid encrypted format; expected iv:cipher:tag");
  }
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ctHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Ensure a directory exists on disk, creating it recursively if needed */
export async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Persist a JSON‐serialisable array of memory entries to a binary file.
 * @param dir  target directory
 * @param id   key (userId or guildId)
 * @param entries  memory entries
 */
export async function saveMemory(
  dir: string,
  id: string,
  entries: GeneralMemoryEntry[]
): Promise<void> {
  await ensureDir(dir);
  const raw = JSON.stringify(entries);
  const path = join(dir, `${id}.bin`);
  await fs.writeFile(path, encrypt(raw), "utf8");
}

/**
 * Load memory entries for a given ID; returns [] if none exist or on error.
 * @param dir  source directory
 * @param id   key (userId or guildId)
 */
export async function loadMemory(
  dir: string,
  id: string
): Promise<GeneralMemoryEntry[]> {
  await ensureDir(dir);
  const path = join(dir, `${id}.bin`);
  if (!existsSync(path)) return [];
  try {
    const enc = await fs.readFile(path, "utf8");
    return JSON.parse(decrypt(enc)) as GeneralMemoryEntry[];
  } catch (err) {
    logger.error(`Failed loading memory ${id} from ${dir}:`, err);
    return [];
  }
}

// Convenience wrappers
export const saveGeneralMemoryForGuild = (
  gid: string,
  e: GeneralMemoryEntry[]
) => saveMemory(GENERAL_MEM_DIR, gid, e);
export const loadGeneralMemoryForGuild = (gid: string) =>
  loadMemory(GENERAL_MEM_DIR, gid);
export const saveUserMemory = (uid: string, e: GeneralMemoryEntry[]) =>
  saveMemory(USER_MEM_DIR, uid, e);
export const loadUserMemory = (uid: string) => loadMemory(USER_MEM_DIR, uid);
export const saveCloneMemory = (uid: string, e: GeneralMemoryEntry[]) =>
  saveMemory(CLONE_MEM_DIR, uid, e);
export const loadCloneMemory = (uid: string) => loadMemory(CLONE_MEM_DIR, uid);

/**
 * Mark a conversation context as dirty so it will be flushed on next save.
 */
export function markContextUpdated(ctx: string): void {
  updatedConversationContexts.add(ctx);
}

/**
 * Save all updated conversation histories & their ID maps to disk.
 */
export async function saveConversations(
  histories: Map<string, Map<string, ConversationContext>>,
  idMaps: Map<string, Map<string, string>>
): Promise<void> {
  await ensureDir(CONVERSATIONS_DIR);
  for (const ctx of updatedConversationContexts) {
    const conv = histories.get(ctx);
    const idMap = idMaps.get(ctx);
    if (!conv || !idMap) continue;

    const data = JSON.stringify(
      Object.fromEntries(
        Array.from(conv.entries()).map(([threadId, ctxObj]) => [
          threadId,
          { messages: Array.from(ctxObj.messages.entries()) },
        ])
      )
    );
    const ids = JSON.stringify(Array.from(idMap.entries()));

    await Promise.all([
      fs.writeFile(
        join(CONVERSATIONS_DIR, `${ctx}.bin`),
        encrypt(data),
        "utf8"
      ),
      fs.writeFile(
        join(CONVERSATIONS_DIR, `${ctx}-idMap.bin`),
        encrypt(ids),
        "utf8"
      ),
    ]);
  }
  updatedConversationContexts.clear();
}

/**
 * Load a single conversation context & its ID map from disk, or initialise empty.
 */
export async function loadConversations(
  ctx: string,
  histories: Map<string, Map<string, ConversationContext>>,
  idMaps: Map<string, Map<string, string>>
): Promise<void> {
  const dataFile = join(CONVERSATIONS_DIR, `${ctx}.bin`);
  const idFile = join(CONVERSATIONS_DIR, `${ctx}-idMap.bin`);
  if (!existsSync(dataFile) || !existsSync(idFile)) {
    histories.set(ctx, new Map());
    idMaps.set(ctx, new Map());
    return;
  }

  try {
    const [encData, encIds] = await Promise.all([
      fs.readFile(dataFile, "utf8"),
      fs.readFile(idFile, "utf8"),
    ]);
    const rawData = JSON.parse(decrypt(encData)) as Record<
      string,
      { messages: [string, ChatMessage][] }
    >;
    const rawIds = JSON.parse(decrypt(encIds)) as [string, string][];

    // Rehydrate conversation map
    const convMap = new Map<string, ConversationContext>();
    for (const [threadId, { messages }] of Object.entries(rawData)) {
      convMap.set(threadId, { messages: new Map(messages) });
    }
    histories.set(ctx, convMap);
    idMaps.set(ctx, new Map(rawIds));
  } catch (err) {
    logger.error(`Failed loading conversations for ${ctx}:`, err);
    histories.set(ctx, new Map());
    idMaps.set(ctx, new Map());
  }
}

/**
 * Asynchronously log an error to the errors directory (daily files).
 */
export async function logErrorToFile(err: unknown): Promise<void> {
  try {
    await ensureDir(ERRORS_DIR);
    const date = new Date().toISOString().slice(0, 10);
    const path = join(ERRORS_DIR, `error-${date}.log`);
    const line = `${new Date().toISOString()} - ${
      err instanceof Error ? err.stack : String(err)
    }\n`;
    await fs.appendFile(path, line, "utf8");
  } catch (fsErr) {
    logger.error("Failed to write to error log:", fsErr);
  }
}
