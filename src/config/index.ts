// src/config.ts

import fs from "fs/promises";
import { join } from "path";
import logger from "../utils/logger.js";

/**
 * Configuration options for per-guild cooldown behavior.
 */
export interface GuildCooldownConfig {
  useCooldown: boolean;
  cooldownTime: number;
  perUserCooldown: boolean;
}

/** Fallback settings used when no guild-specific config is found. */
export const defaultCooldownConfig: GuildCooldownConfig = {
  useCooldown: true,
  cooldownTime: 1.25,
  perUserCooldown: true,
};

/** In-memory cache of guild-specific cooldown configurations. */
export const guildCooldownConfigs = new Map<string, GuildCooldownConfig>();

/** File path for persisting guild cooldown configurations. */
const CONFIG_FILE_PATH = join(
  process.cwd(),
  "data",
  "guildCooldownConfigs.json"
);

/**
 * Load guild cooldown configurations from disk into memory.
 * If the file is missing or malformed, logs a warning and proceeds with defaults.
 */
export async function loadGuildCooldownConfigs(): Promise<void> {
  try {
    const fileContents = await fs.readFile(CONFIG_FILE_PATH, "utf-8");
    const parsed = JSON.parse(fileContents) as Record<
      string,
      GuildCooldownConfig
    >;
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
