/**
 * @file src/config/paths.ts
 * @description Centralised definitions of all filesystem paths used by the bot.
 */

import { join } from "path";

export const DATA_DIR = join(process.cwd(), "data");
export const GUILD_CONFIG_FILE = join(DATA_DIR, "guildConfigs.json");
export const OUTPUT_DIR = join(DATA_DIR, "output");
export const USER_MEM_DIR = join(DATA_DIR, "memory", "user");
export const CLONE_MEM_DIR = join(DATA_DIR, "memory", "clone");
export const CONV_DIR = join(DATA_DIR, "conversations");
export const LOGS_DIR = join(process.cwd(), "logs");
export const LOGS_ERROR_DIR = join(LOGS_DIR, "error");
