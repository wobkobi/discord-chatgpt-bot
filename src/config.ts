import fs from "fs/promises";
import { join } from "path";

export const defaultCooldownConfig = {
  useCooldown: true,
  // Default cooldown time in milliseconds.
  cooldownTime: 1.25,
  // true = each user gets their own cooldown; false = whole server shares one cooldown.
  perUserCooldown: true,
};

// Map keyed by guild ID to store guild-specific cooldown configurations.
export const guildCooldownConfigs = new Map<
  string,
  {
    useCooldown: boolean;
    cooldownTime: number;
    perUserCooldown: boolean;
  }
>();

// Define where to store the JSON file (adjust the path as needed).
const CONFIG_FILE_PATH = join(
  process.cwd(),
  "data",
  "guildCooldownConfigs.json"
);

/**
 * Loads guild cooldown configurations from disk.
 */
export async function loadGuildCooldownConfigs(): Promise<void> {
  try {
    const data = await fs.readFile(CONFIG_FILE_PATH, "utf-8");
    const parsed = JSON.parse(data) as Record<
      string,
      { useCooldown: boolean; cooldownTime: number; perUserCooldown: boolean }
    >;
    Object.entries(parsed).forEach(([guildId, config]) => {
      guildCooldownConfigs.set(guildId, config);
    });
    console.log("Loaded guild cooldown configs.");
  } catch (error) {
    void error;
    console.warn(
      "No guild cooldown config file found or failed to load; starting fresh."
    );
  }
}

/**
 * Saves guild cooldown configurations to disk.
 */
export async function saveGuildCooldownConfigs(): Promise<void> {
  try {
    const obj: Record<
      string,
      { useCooldown: boolean; cooldownTime: number; perUserCooldown: boolean }
    > = {};
    guildCooldownConfigs.forEach((config, guildId) => {
      obj[guildId] = config;
    });
    // Ensure the data directory exists.
    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(obj, null, 2), "utf-8");
    console.log("Saved guild cooldown configs.");
  } catch (error) {
    void error;
    console.error("Failed to save guild cooldown configs.");
  }
}
