/**
 * @file src/config/index.ts
 * @description Defines, loads and persists per-guild settings in a single JSON:
 *   • message cooldown configuration
 *   • random interjection “1-in-N” rate
 *
 *   In-memory cache, JSON persistence, default values, and detailed logging.
 */
import fs from "fs/promises";
import logger from "../utils/logger.js";
import { DATA_DIR, GUILD_CONFIG_FILE } from "./paths.js";

// Cooldown settings for a guild.
export interface GuildCooldownConfig {
  // Enable/disable the cooldown logic.
  useCooldown: boolean;
  // Cooldown duration in seconds.
  cooldownTime: number;
  // Apply separately per user rather than globally.
  perUserCooldown: boolean;
}

// Combined per-guild settings.
export interface GuildConfig {
  // Message cooldown parameters.
  cooldown: GuildCooldownConfig;
  // Random interjection rate: 1-in-N chance.
  interjectionRate: number;
}

// Default cooldown: on, 2.5 s, per-user.
export const defaultCooldownConfig: GuildCooldownConfig = {
  useCooldown: true,
  cooldownTime: 2.5,
  perUserCooldown: true,
};

// Default interjection rate: once in 200 messages.
export const defaultInterjectionRate = 200;

// In-memory cache of all guilds’ settings.
export const guildConfigs = new Map<string, GuildConfig>();

/**
 * Load all guild configs from disk (one file).
 * Falls back to defaults if file missing or malformed.
 */
export async function loadGuildConfigs(): Promise<void> {
  logger.debug("[config] Loading guild configurations");
  try {
    const raw = await fs.readFile(GUILD_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, GuildConfig>;
    for (const [guildId, cfg] of Object.entries(parsed)) {
      guildConfigs.set(guildId, {
        cooldown: cfg.cooldown ?? defaultCooldownConfig,
        interjectionRate: cfg.interjectionRate ?? defaultInterjectionRate,
      });
      logger.debug(
        `[config] Loaded config for guild=${guildId}: ${JSON.stringify(
          guildConfigs.get(guildId)
        )}`
      );
    }
    logger.info("✅ Loaded all guild configurations");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn(
        "[config] No guild config file found; will use defaults until first save"
      );
    } else {
      logger.error("[config] Failed to load guild configurations:", err);
    }
  }
}

/**
 * Save all guild configs back to disk in one JSON.
 * Ensures the data directory exists.
 */
export async function saveGuildConfigs(): Promise<void> {
  logger.debug("[config] Saving guild configurations");
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const toSave: Record<string, GuildConfig> = {};
    for (const [guildId, cfg] of guildConfigs.entries()) {
      toSave[guildId] = cfg;
      logger.debug(
        `[config] Queued config for guild=${guildId}: ${JSON.stringify(cfg)}`
      );
    }
    await fs.writeFile(
      GUILD_CONFIG_FILE,
      JSON.stringify(toSave, null, 2),
      "utf-8"
    );
    logger.info("✅ Saved all guild configurations");
  } catch (err: unknown) {
    logger.error("[config] Failed to save guild configurations:", err);
  }
}
