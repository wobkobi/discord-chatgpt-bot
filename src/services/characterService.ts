// src/services/characterService.ts
// Loads persona configuration and builds system prompts and metadata for the AI.

import { DATA_DIR } from "@/config/paths";
import { userMemory } from "@/store/userMemory";
import { PersonaConfig } from "@/types/persona";
import { getOptional } from "@/utils/env";
import logger from "@/utils/logger";
import { existsSync, readFileSync } from "fs";
import { DateTime } from "luxon";
import path from "path";

/** Repo-local config folder, kept as a fallback so a plain checkout still runs. */
const SRC_CONFIG_DIR = path.resolve(process.cwd(), "src/config");

/**
 * Finds the persona file. PERSONA_FILE wins when set, then data/persona.json, then the
 * repo-local src/config/persona.json. Each bot is the same image with its own data/
 * mount, so data/ is where a per-bot persona belongs.
 * @returns Absolute path of the persona file to load, or null if none exists.
 * @throws {Error} If PERSONA_FILE is set but points at a missing file, since a typo
 *   there would otherwise silently start the bot with an empty persona.
 */
function resolvePersonaFile(): string | null {
  const explicit = getOptional("PERSONA_FILE");
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(`PERSONA_FILE is set to ${resolved}, but that file does not exist`);
    }
    return resolved;
  }
  const candidates = [
    path.join(DATA_DIR, "persona.json"),
    path.join(SRC_CONFIG_DIR, "persona.json"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Loads the persona config, falling back to an empty persona when no file exists.
 * @returns The parsed persona config.
 */
function loadPersona(): PersonaConfig {
  const file = resolvePersonaFile();
  if (!file) {
    logger.warn("[characterService] No persona.json found; continuing with defaults.");
    return { cloneUserId: "", baseDescription: "" };
  }
  try {
    const persona = JSON.parse(readFileSync(file, "utf-8")) as PersonaConfig;
    logger.info(`[characterService] Persona loaded from ${file}`);
    return persona;
  } catch (err: unknown) {
    logger.error(`[characterService] Failed to load persona config from ${file}:`, err);
    throw err;
  }
}

const persona = loadPersona();

/**
 * Loads the Discord markdown formatting guide from disk: data/markdownGuide.md first, then
 * src/config/markdownGuide.md, then the committed example.
 * @returns The guide content, or an empty string if no file is found.
 */
function loadMarkdownGuide(): string {
  const candidates = [
    path.join(DATA_DIR, "markdownGuide.md"),
    path.join(SRC_CONFIG_DIR, "markdownGuide.md"),
  ];
  const custom = candidates.find((p) => existsSync(p));
  if (custom) return readFileSync(custom, "utf-8");
  try {
    logger.warn("[characterService] markdownGuide.md not found; falling back to example.");
    return readFileSync(path.join(SRC_CONFIG_DIR, "markdownGuide.example.md"), "utf-8");
  } catch {
    logger.warn("[characterService] No markdownGuide found; formatting guide disabled.");
    return "";
  }
}

/** ID of the clone user, used to apply clone-specific behaviours. */
export const cloneUserId = persona.cloneUserId;

const LOCALE = Intl.DateTimeFormat().resolvedOptions().locale;

/** Markdown formatting guide loaded from markdownGuide.md (falls back to example). */
export const markdownGuide = loadMarkdownGuide();

/**
 * Builds the persona description for system prompts.
 * If the user is the clone, appends a snippet of their recent style from memory.
 * @param userId - Discord user ID; if it equals cloneUserId, a style snippet is appended.
 * @returns Fully assembled persona prompt (without timestamp or markdown guide).
 */
export function getCharacterDescription(userId?: string): string {
  let description = persona.baseDescription;

  if (userId === cloneUserId && userMemory.has(userId)) {
    const entries = userMemory.get(userId) ?? [];
    const snippet = entries.length
      ? entries
          .slice(-5)
          .map((e) => e.content)
          .join(" ")
          .slice(0, 150)
      : "Not enough data to learn your personality.";
    description += `\n\nAs a clone, your recent style: ${snippet}`;
  }

  return description;
}

/**
 * Returns the current timestamp as a short system message.
 * Kept separate from the static markdownGuide so the guide can be prompt-cached.
 * @returns Localised timestamp string, ready to inject as a system message.
 */
export function getSystemMetadata(): string {
  const now = DateTime.now().setLocale(LOCALE).toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);
  return `_Current time: ${now}_`;
}
