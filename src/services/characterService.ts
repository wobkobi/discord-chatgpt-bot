/**
 * @file src/services/characterService.ts
 * @description Loads persona configuration and builds system prompts and metadata for the AI.
 */

import { userMemory } from "@/store/userMemory.js";
import { PersonaConfig } from "@/types/persona.js";
import logger from "@/utils/logger.js";
import { readFileSync } from "fs";
import { DateTime } from "luxon";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

let persona: PersonaConfig;
try {
  persona = require(path.resolve(process.cwd(), "src/config/persona.json")) as PersonaConfig;
} catch (err: unknown) {
  if ((err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
    logger.warn("[characterService] persona.json not found; continuing with defaults.");
    persona = { cloneUserId: "", baseDescription: "" };
  } else {
    logger.error("[characterService] Failed to load persona config:", err);
    throw err;
  }
}

/**
 * Loads the Discord markdown formatting guide from disk.
 * @returns The guide content, or an empty string if no file is found.
 */
function loadMarkdownGuide(): string {
  const custom = path.resolve(process.cwd(), "src/config/markdownGuide.md");
  const example = path.resolve(process.cwd(), "src/config/markdownGuide.example.md");
  try {
    return readFileSync(custom, "utf-8");
  } catch {
    try {
      logger.warn("[characterService] markdownGuide.md not found; falling back to example.");
      return readFileSync(example, "utf-8");
    } catch {
      logger.warn("[characterService] No markdownGuide found; formatting guide disabled.");
      return "";
    }
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
export async function getCharacterDescription(userId?: string): Promise<string> {
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
