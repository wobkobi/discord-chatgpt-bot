import fs from "fs/promises";
import { join } from "path";
import logger from "./utils/logger.js";

export interface GuildCooldownConfig {
  useCooldown: boolean;
  cooldownTime: number;
  perUserCooldown: boolean;
}

export const defaultCooldownConfig: GuildCooldownConfig = {
  useCooldown: true,
  cooldownTime: 1.25,
  perUserCooldown: true,
};

export const guildCooldownConfigs = new Map<string, GuildCooldownConfig>();

const CONFIG_FILE_PATH = join(
  process.cwd(),
  "data",
  "guildCooldownConfigs.json"
);

/**
 * Loads guild cooldown configurations from disk and populates the in-memory map.
 */
export async function loadGuildCooldownConfigs(): Promise<void> {
  try {
    const data = await fs.readFile(CONFIG_FILE_PATH, "utf-8");
    const parsed = JSON.parse(data) as Record<string, GuildCooldownConfig>;
    Object.entries(parsed).forEach(([guildId, config]) => {
      guildCooldownConfigs.set(guildId, config);
    });
    logger.info("Loaded guild cooldown configs.");
  } catch {
    logger.warn(
      "No guild cooldown config file found or failed to load; starting fresh."
    );
  }
}

/**
 * Saves the current guild cooldown configurations from the in-memory map to disk.
 */
export async function saveGuildCooldownConfigs(): Promise<void> {
  try {
    const obj: Record<string, GuildCooldownConfig> = {};
    guildCooldownConfigs.forEach((config, guildId) => {
      obj[guildId] = config;
    });
    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(obj, null, 2), "utf-8");
    logger.info("Saved guild cooldown configs.");
  } catch (error) {
    logger.error("Failed to save guild cooldown configs.", error);
  }
}
