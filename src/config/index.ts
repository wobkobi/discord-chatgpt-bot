/**
 * @file src/config/index.ts
 * @description Defines, loads and persists per-guild settings: cooldown configuration and interjection rate.
 */

import { DATA_DIR, GUILD_CONFIG_FILE } from "@/config/paths.js";
import { GuildConfig, GuildCooldownConfig } from "@/types/guild.js";
import logger from "@/utils/logger.js";
import fs from "fs/promises";

/** Default cooldown: on, 2.5 s, per-user. */
export const defaultCooldownConfig: GuildCooldownConfig = {
  useCooldown: true,
  cooldownTime: 2.5,
  perUserCooldown: true,
};

/** Default interjection rate: once in 100 messages. */
export const defaultInterjectionRate = 100;

/** In-memory cache of all guilds' settings. */
export const guildConfigs = new Map<string, GuildConfig>();

/**
 * Load all guild configs from disk. Falls back to defaults if file missing or malformed.
 * @returns Promise that resolves once all configs have been loaded into the in-memory cache.
 */
export async function loadGuildConfigs(): Promise<void> {
  try {
    const raw = await fs.readFile(GUILD_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, GuildConfig>;
    for (const [guildId, cfg] of Object.entries(parsed)) {
      guildConfigs.set(guildId, {
        cooldown: cfg.cooldown ?? defaultCooldownConfig,
        interjectionRate: cfg.interjectionRate ?? defaultInterjectionRate,
      });
    }
    logger.info("✅ Loaded all guild configurations");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn("[config] No guild config file found; using defaults");
    } else {
      logger.error("[config] Failed to load guild configurations:", err);
    }
  }
}

/**
 * Save all guild configs back to disk in one JSON file.
 * @returns Promise that resolves once the file has been written.
 */
export async function saveGuildConfigs(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const toSave: Record<string, GuildConfig> = {};
    for (const [guildId, cfg] of guildConfigs.entries()) {
      toSave[guildId] = cfg;
    }
    await fs.writeFile(GUILD_CONFIG_FILE, JSON.stringify(toSave, null, 2), "utf-8");
    logger.info("✅ Saved all guild configurations");
  } catch (err: unknown) {
    logger.error("[config] Failed to save guild configurations:", err);
  }
}
