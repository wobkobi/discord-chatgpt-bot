import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { promises as fs } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import ChatMessage from "../types/chatMessage.js";
import ConversationContext from "../types/conversationContext.js";

const DATA_DIRECTORY = "./data";

const updatedServers = new Set<string>(); // Tracks which server IDs need saving

const ENCRYPTION_KEY = Buffer.from(
  process.env.ENCRYPTION_KEY || "Crazy?IWasCrazyOnce.TheyLockedMe",
  "utf-8"
);
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
        const serverDataPath = `${DATA_DIRECTORY}/${serverId}`;
        await ensureDirectoryExists(serverDataPath);

        const conversationsData = JSON.stringify(
          Array.from(histories.entries()).reduce<{
            [key: string]: {
              messages: [string, ChatMessage][];
            };
          }>((obj, [key, context]) => {
            // Ensure each key in the object maps to an object with a 'messages' property
            obj[key] = {
              messages: Array.from(context.messages.entries()),
            };
            return obj;
          }, {})
        );

        const idMappingsData = JSON.stringify(Array.from(idMap.entries()));

        const conversationsFile = `${serverDataPath}/conversations.bin`;
        const idMapFile = `${serverDataPath}/idMap.bin`;

        await Promise.all([
          writeFile(conversationsFile, encrypt(conversationsData), "utf-8"),
          writeFile(idMapFile, encrypt(idMappingsData), "utf-8"),
        ]);
      }
    }
    updatedServers.clear(); // Reset the tracker after saving
  } catch (error) {
    console.error("Failed to save data:", error);
  }
}

async function loadConversations(
  serverId: string,
  conversationHistories: Map<string, Map<string, ConversationContext>>,
  conversationIdMap: Map<string, Map<string, string>>
) {
  const serverDir = join(DATA_DIRECTORY, serverId);
  const conversationsFile = join(serverDir, "conversations.bin");
  const idMapFile = join(serverDir, "idMap.bin");

  await ensureDirectoryExists(serverDir);

  try {
    const conversationsData: {
      [key: string]: {
        messages: [string, ChatMessage][];
      };
    } = JSON.parse(decrypt(await fs.readFile(conversationsFile, "utf-8")));
    const idMapData: [string, string][] = JSON.parse(
      decrypt(await fs.readFile(idMapFile, "utf-8"))
    );

    const newConversationMap = new Map<string, ConversationContext>();
    Object.entries(conversationsData).forEach(([key, value]) => {
      if (value.messages) {
        newConversationMap.set(key, { messages: new Map(value.messages) });
      }
    });
    conversationHistories.set(serverId, newConversationMap);

    const newIDMap = new Map(idMapData);
    conversationIdMap.set(serverId, newIDMap);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(
        `No data found for server ${serverId}. Initialising new files.`
      );
      conversationHistories.set(serverId, new Map());
      conversationIdMap.set(serverId, new Map());
    } else {
      console.error(`Failed to load data for server ${serverId}:`, error);
      throw error;
    }
  }
}

function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(text: string): string {
  const textParts = text.split(":");
  const iv = Buffer.from(textParts[0], "hex");
  const encryptedText = Buffer.from(textParts[1], "hex");
  const decipher = createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

async function ensureDirectoryExists(directoryPath: string) {
  try {
    await fs.access(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.mkdir(directoryPath, { recursive: true });
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
