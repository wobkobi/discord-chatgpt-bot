/**
 * @file src/config/index.ts
 * @description Defines and persists per-guild cooldown configuration for the bot.
 */

import fs from "fs/promises";
import { join } from "path";
import logger from "../utils/logger.js";

/**
 * Configuration options for per-guild cooldown behavior.
 */
export interface GuildCooldownConfig {
  /** Whether cooldown logic is enabled for this guild. */
  useCooldown: boolean;
  /** Duration of the cooldown period, in seconds. */
  cooldownTime: number;
  /** If true, applies cooldown separately per user instead of globally. */
  perUserCooldown: boolean;
}

/**
 * Default settings used when no guild-specific config is found.
 */
export const defaultCooldownConfig: GuildCooldownConfig = {
  useCooldown: true,
  cooldownTime: 2.5,
  perUserCooldown: true,
};

/**
 * In-memory cache of guild-specific cooldown configurations.
 */
export const guildCooldownConfigs = new Map<string, GuildCooldownConfig>();

/**
 * Absolute path to the JSON file persisting guild cooldown settings.
 */
const CONFIG_FILE_PATH = join(
  process.cwd(),
  "data",
  "guildCooldownConfigs.json"
);

/**
 * Load persisted guild cooldown configurations from disk into memory.
 * If the file is missing or malformed, logs a warning and continues with defaults.
 *
 * @async
 * @returns A promise that resolves when loading is complete.
 */
export async function loadGuildCooldownConfigs(): Promise<void> {
  try {
    const file = await fs.readFile(CONFIG_FILE_PATH, "utf-8");
    const parsed: Record<string, GuildCooldownConfig> = JSON.parse(file);
    for (const [guildId, config] of Object.entries(parsed)) {
      guildCooldownConfigs.set(guildId, config);
    }
    logger.info("✅ Loaded guild cooldown configurations from disk.");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn("⚠️ No cooldown config file found; using defaults.");
    } else {
      logger.error("❌ Failed to load guild cooldown configs:", err);
    }
  }
}

/**
 * Persist the current in-memory guild cooldown configurations to disk.
 * Creates the data directory if it does not exist.
 *
 * @async
 * @returns A promise that resolves when save is complete.
 */
export async function saveGuildCooldownConfigs(): Promise<void> {
  try {
    const toSave: Record<string, GuildCooldownConfig> = {};
    for (const [guildId, config] of guildCooldownConfigs.entries()) {
      toSave[guildId] = config;
    }

    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(
      CONFIG_FILE_PATH,
      JSON.stringify(toSave, null, 2),
      "utf-8"
    );
    logger.info("✅ Saved guild cooldown configurations to disk.");
  } catch (err: unknown) {
    logger.error("❌ Failed to save guild cooldown configs:", err);
  }
}
