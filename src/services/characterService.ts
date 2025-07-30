/**
 * @file src/services/characterService.ts
 * @description Loads persona configuration and builds system prompts and metadata
 *   for the AI, including clone-specific styling and markdown guidelines.
 *
 *   - Reads JSON persona data via ESM require
 *   - Exposes:
 *     • getCharacterDescription: base persona + clone style snippet (if clone)
 *     • getSystemMetadata: timestamp + markdown guide (always injected)
 *   If persona.json is missing, falls back to empty defaults rather than crashing.
 */

import { PersonaConfig } from "@/types/persona.js";
import { DateTime } from "luxon";
import { createRequire } from "module";
import path from "path";
import { userMemory } from "../store/userMemory.js";
import logger from "../utils/logger.js";

// Use createRequire to load JSON in ESM without import assertions
const require = createRequire(import.meta.url);

let persona: PersonaConfig;
try {
  persona = require(
    path.resolve(process.cwd(), "src/config/persona.json")
  ) as PersonaConfig;
  logger.debug(
    `[characterService] Loaded persona config (cloneUserId=${persona.cloneUserId})`
  );
} catch (err: unknown) {
  // If persona.json is missing, log a warning and use empty defaults.
  if ((err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
    logger.warn(
      "[characterService] persona.json not found; continuing with defaults."
    );
    persona = {
      cloneUserId: "",
      baseDescription: "",
      markdownGuide: "",
    };
  } else {
    logger.error("[characterService] Failed to load persona config:", err);
    throw err;
  }
}

// ID of the clone user, used to apply clone-specific behaviours.
export const cloneUserId = persona.cloneUserId;
// Markdown formatting guide from persona configuration.
export const markdownGuide = persona.markdownGuide;

/**
 * Builds the persona description for system prompts.
 * Includes the baseDescription and, if the user is the clone, a snippet of recent style.
 * @param userId - Discord user ID; if it equals cloneUserId, includes a style snippet.
 * @returns Fully assembled persona prompt (without timestamp or markdown guide).
 */
export async function getCharacterDescription(
  userId?: string
): Promise<string> {
  logger.debug(
    `[characterService] Generating persona description for userId=${userId}`
  );

  let description = persona.baseDescription;

  if (userId === cloneUserId && userMemory.has(userId)) {
    const entries = userMemory.get(userId) || [];
    const snippet = entries.length
      ? entries
          .slice(-5)
          .map((e) => e.content)
          .join(" ")
          .slice(0, 150)
      : "Not enough data to learn your personality.";
    logger.debug(`[characterService] Style snippet: ${snippet}`);
    description += `\n\nAs a clone, your recent style: ${snippet}`;
  }

  return description;
}

/**
 * Builds system metadata for prompts.
 * Always includes the current timestamp and the markdown formatting guide.
 * @returns String containing timestamp and markdownGuide, ready to inject as a system message.
 */
export function getSystemMetadata(): string {
  logger.debug("[characterService] Generating system metadata");

  const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  const now = DateTime.now()
    .setLocale(systemLocale)
    .toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);

  const meta = `_Current time: ${now}_` + `\n\n${markdownGuide}`;
  return meta;
}
