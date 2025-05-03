// src/config/paths.ts
import { join } from "path";

/** Base directory under which all persisted bot data lives */
export const DATA_DIR = join(process.cwd(), "data");

/** Sub‑directory for LaTeX renderer outputs */
export const OUTPUT_DIR = join(DATA_DIR, "output");

/** Where per‑guild cooldown JSON is stored */
export const CONFIG_FILE = join(DATA_DIR, "guildCooldownConfigs.json");

/** Memory storage directories */
export const USER_MEM_DIR = join(DATA_DIR, "memory", "user");
export const CLONE_MEM_DIR = join(DATA_DIR, "memory", "clone");

/** Conversation threads persistence */
export const CONV_DIR = join(DATA_DIR, "conversations");

/** ─── New: Logging directories ───────────────────────────────────────────── */

/** Root directory for all log files */
export const LOGS_DIR = join(process.cwd(), "logs");
/** Sub‑directory for error‑level log files */
export const LOGS_ERROR_DIR = join(LOGS_DIR, "error");
