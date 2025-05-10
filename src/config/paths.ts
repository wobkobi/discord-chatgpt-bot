/**
 * @file src/config/paths.ts
 * @description Centralised definitions of all filesystem paths used by the bot.
 *
 *   Provides a single source of truth for data storage and log directories.
 *   Constants are logged at startup for debug tracing.
 */
import { join } from "path";

/**
 * Base directory under which all persisted bot data lives.
 */
export const DATA_DIR = join(process.cwd(), "data");

/**
 * Single JSON file for all per-guild settings (cooldown + interjection rate).
 */
export const GUILD_CONFIG_FILE = join(DATA_DIR, "guildConfigs.json");

/**
 * Sub-directory for LaTeX renderer outputs (SVG, PNG, JPG).
 */
export const OUTPUT_DIR = join(DATA_DIR, "output");

/**
 * Directory for storing long-term memory entries for regular users.
 */
export const USER_MEM_DIR = join(DATA_DIR, "memory", "user");

/**
 * Directory for storing memory entries specific to the clone persona.
 */
export const CLONE_MEM_DIR = join(DATA_DIR, "memory", "clone");

/**
 * Directory for persisting conversation thread data.
 */
export const CONV_DIR = join(DATA_DIR, "conversations");

/** ─── Logging directories ─────────────────────────────────────────────────── */

/**
 * Root directory for all Winston log files (combined and others).
 */
export const LOGS_DIR = join(process.cwd(), "logs");

/**
 * Sub-directory under LOGS_DIR for error-level logs with daily rotation.
 */
export const LOGS_ERROR_DIR = join(LOGS_DIR, "error");
