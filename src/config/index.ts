/**
 * @file src/config/index.ts
 * @description Defines, loads, and persists per-guild cooldown configuration for the bot.
 * @remarks
 *   Provides in-memory caching, JSON persistence, and default settings loaded on startup.
 *   Uses logger.debug for detailed tracing.
 */

import fs from "fs/promises";
import logger from "../utils/logger.js";
import { CONFIG_FILE, DATA_DIR } from "./paths.js";

/**
 * Configuration options for per-guild cooldown behaviour.
 */
export interface GuildCooldownConfig {
  /** Whether cooldown logic is enabled for this guild. */
  useCooldown: boolean;
  /** Duration of the cooldown period, in seconds. */
  cooldownTime: number;
  /** If true, applies cooldown separately per user rather than globally. */
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
 * Maps guild ID strings to their respective config objects.
 */
export const guildCooldownConfigs = new Map<string, GuildCooldownConfig>();

/**
 * Load persisted guild cooldown configurations from disk into memory.
 * If the file is missing or malformed, logs a warning and continues with defaults.
 *
 * @async
 * @returns Promise<void> that resolves when loading is complete.
 */
export async function loadGuildCooldownConfigs(): Promise<void> {
  logger.debug("[config] Loading guild cooldown configurations from disk");
  try {
    const file = await fs.readFile(CONFIG_FILE, "utf-8");
    const parsed: Record<string, GuildCooldownConfig> = JSON.parse(file);
    for (const [guildId, config] of Object.entries(parsed)) {
      guildCooldownConfigs.set(guildId, config);
      logger.debug(
        `[config] Loaded config for guildId=${guildId}: ${JSON.stringify(config)}`
      );
    }
    logger.info("✅ Loaded guild cooldown configurations from disk");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      logger.warn("⚠️ No cooldown config file found; using default settings");
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
 * @returns Promise<void> that resolves when save is complete.
 */
export async function saveGuildCooldownConfigs(): Promise<void> {
  logger.debug("[config] Saving guild cooldown configurations to disk");
  try {
    const toSave: Record<string, GuildCooldownConfig> = {};
    for (const [guildId, config] of guildCooldownConfigs.entries()) {
      toSave[guildId] = config;
      logger.debug(
        `[config] Queued config for guildId=${guildId}: ${JSON.stringify(config)}`
      );
    }

    // Ensure data directory exists
    const dir = DATA_DIR;
    await fs.mkdir(dir, { recursive: true });
    logger.debug(`[config] Ensured data directory exists at ${dir}`);

    // Write JSON with 2-space indentation for readability
    await fs.writeFile(CONFIG_FILE, JSON.stringify(toSave, null, 2), "utf-8");
    logger.info("✅ Saved guild cooldown configurations to disk");
  } catch (err: unknown) {
    logger.error("❌ Failed to save guild cooldown configs:", err);
  }
}
