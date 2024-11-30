import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import fs from "fs";
import { writeFile } from "fs/promises";
import path, { join } from "path";
import { ChatMessage, ConversationContext } from "../types/types.js";

const DATA_DIRECTORY = "./data";
const updatedServers = new Set<string>(); // Tracks which server IDs need saving

import dotenv from "dotenv";
dotenv.config();

// Create a 32-byte encryption key from the environment variable
const ENCRYPTION_KEY_BASE = process.env.ENCRYPTION_KEY_BASE || "";

// Check if the environment variable is provided
if (!ENCRYPTION_KEY_BASE) {
  throw new Error("ENCRYPTION_KEY_BASE environment variable is required.");
}

// Generate a 32-byte key using SHA-256 hash
const ENCRYPTION_KEY = createHash("sha256")
  .update(ENCRYPTION_KEY_BASE)
  .digest();

// The IV (Initialization Vector) ensures different ciphertexts for identical plaintext
const IV_LENGTH = 16;

export async function saveConversations(
  conversationHistories: Map<string, Map<string, ConversationContext>>,
  conversationIdMap: Map<string, Map<string, string>>
) {
  try {
    await ensureDirectoryExists(DATA_DIRECTORY);

    for (const serverId of updatedServers) {
      const histories = conversationHistories.get(serverId);
      const idMap = conversationIdMap.get(serverId);

      if (histories && idMap) {
        const serverDataPath = join(DATA_DIRECTORY, serverId);
        await ensureDirectoryExists(serverDataPath);

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
          writeFile(
            join(serverDataPath, "conversations.bin"),
            encrypt(conversationsData),
            "utf-8"
          ),
          writeFile(
            join(serverDataPath, "idMap.bin"),
            encrypt(idMappingsData),
            "utf-8"
          ),
        ]);
      }
    }
    updatedServers.clear();
  } catch (error) {
    saveErrorToFile(error);
  }
}

export async function loadConversations(
  serverId: string,
  conversationHistories: Map<string, Map<string, ConversationContext>>,
  conversationIdMap: Map<string, Map<string, string>>
) {
  const serverDir = join(DATA_DIRECTORY, serverId);
  const conversationsFile = join(serverDir, "conversations.bin");
  const idMapFile = join(serverDir, "idMap.bin");

  if (!fs.existsSync(conversationsFile) || !fs.existsSync(idMapFile)) {
    conversationHistories.set(serverId, new Map());
    conversationIdMap.set(serverId, new Map());
    return;
  }

  try {
    const conversationsData = JSON.parse(
      decrypt(await fs.promises.readFile(conversationsFile, "utf-8"))
    );

    const idMapData: [string, string][] = JSON.parse(
      decrypt(await fs.promises.readFile(idMapFile, "utf-8"))
    );

    const newConversationMap = new Map<string, ConversationContext>();
    Object.entries(conversationsData).forEach(([key, value]) => {
      const context = value as { messages: [string, ChatMessage][] };
      if (context.messages) {
        newConversationMap.set(key, { messages: new Map(context.messages) });
      }
    });
    conversationHistories.set(serverId, newConversationMap);

    const newIDMap = new Map(idMapData);
    conversationIdMap.set(serverId, newIDMap);
  } catch (error) {
    saveErrorToFile(error);
    throw error;
  }
}

function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(text, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Return IV, encrypted text, and authentication tag
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

function decrypt(text: string): string {
  const textParts = text.split(":");
  if (textParts.length !== 3) {
    throw new Error(
      "Invalid encrypted text format. Expected 'iv:encryptedData:authTag'."
    );
  }

  const iv = Buffer.from(textParts[0], "hex");
  const encryptedText = Buffer.from(textParts[1], "hex");
  const authTag = Buffer.from(textParts[2], "hex");

  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString("utf8");
}

async function ensureDirectoryExists(directoryPath: string) {
  try {
    await fs.promises.access(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.promises.mkdir(directoryPath, { recursive: true });
    } else {
      throw error;
    }
  }
}

export async function ensureFileExists(
  serverIds: string[],
  conversationHistories: Map<string, Map<string, ConversationContext>>,
  conversationIdMap: Map<string, Map<string, string>>
) {
  await Promise.all(
    serverIds.map((serverId) =>
      loadConversations(serverId, conversationHistories, conversationIdMap)
    )
  );
}

export function markServerAsUpdated(serverId: string) {
  updatedServers.add(serverId);
}

export function saveErrorToFile(error: unknown) {
  const errorsFolderPath = path.resolve("errors");
  const currentDate = new Date().toISOString().split("T")[0];
  const errorLogPath = path.join(errorsFolderPath, `error-${currentDate}.log`);

  if (!fs.existsSync(errorsFolderPath)) {
    fs.mkdirSync(errorsFolderPath);
  }

  const errorMessage = `${new Date().toISOString()} - ${
    error instanceof Error ? error.stack : error
  }\n`;

  fs.appendFile(errorLogPath, errorMessage, (err) => {
    if (err) {
      console.error("Failed to write error to file:", err);
    }
  });
}
