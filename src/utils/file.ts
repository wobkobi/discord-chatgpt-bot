import { promises as fs } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import ChatMessage from "../types/chatMessage.js";
import ConversationContext from "../types/conversationContext.js";

const DATA_DIRECTORY = "./data";
const updatedServers = new Set<string>(); // Tracks which server IDs need saving

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
          Array.from(histories.entries()).reduce<ConversationsStructure>(
            (obj, [key, context]) => {
              // Ensure each key in the object maps to an object with a 'messages' property
              obj[key] = {
                messages: Array.from(context.messages.entries()),
              };
              return obj;
            },
            {}
          )
        );

        const idMappingsData = JSON.stringify(Array.from(idMap.entries()));

        const conversationsFile = `${serverDataPath}/conversations.json`;
        const idMapFile = `${serverDataPath}/idMap.json`;

        await Promise.all([
          writeFile(conversationsFile, conversationsData, "utf-8"),
          writeFile(idMapFile, idMappingsData, "utf-8"),
        ]);

        console.log(`Data saved successfully for server ${serverId}.`);
      }
    }
    updatedServers.clear(); // Reset the tracker after saving
  } catch (error) {
    console.error("Failed to save data:", error);
  }
}

type ConversationsStructure = {
  [key: string]: {
    messages: [string, ChatMessage][];
  };
};

export function markServerAsUpdated(serverId: string) {
  updatedServers.add(serverId);
}

// TODO: FIX CAUSE IT DOESNT WORK ON RELOAD IDK WHY
async function loadConversations(
  serverId: string,
  conversationHistories: Map<string, Map<string, ConversationContext>>,
  conversationIdMap: Map<string, Map<string, string>>
) {
  const serverDir = join(DATA_DIRECTORY, serverId);
  const conversationsFile = join(serverDir, "conversations.json");
  const idMapFile = join(serverDir, "idMap.json");

  // Ensure the server-specific directory exists
  await ensureDirectoryExists(serverDir);

  // Load or initialize conversation data
  try {
    const conversationsData = JSON.parse(
      await fs.readFile(conversationsFile, "utf-8")
    );
    const idMapData = JSON.parse(await fs.readFile(idMapFile, "utf-8"));

    conversationHistories.set(
      serverId,
      new Map(conversationsData as [string, ConversationContext][])
    );
    conversationIdMap.set(serverId, new Map(idMapData as [string, string][]));
    console.log(`Data loaded successfully for server ${serverId}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // If no data, initialize empty maps
      conversationHistories.set(serverId, new Map());
      conversationIdMap.set(serverId, new Map());

      console.log(`Initialized new data structures for server ${serverId}`);
    } else {
      console.error(`Failed to load data for server ${serverId}:`, error);
      throw error;
    }
  }
}

async function ensureDirectoryExists(directoryPath: string) {
  try {
    await fs.access(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(`Creating directory: ${directoryPath}`);
      await fs.mkdir(directoryPath, { recursive: true });
    } else {
      throw error;
    }
  }
}

// Function to load conversations for a given server

// Ensure file existence for all servers
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
