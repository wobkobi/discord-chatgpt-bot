/**
 * @file src/services/characterService.ts
 * @description Loads persona configuration and constructs the system prompt for the AI,
 *   including clone-specific styling, timestamp, and markdown guidelines.
 * @remarks
 *   Reads JSON persona data, handles TeX escaping, and assembles the full system prompt
 *   for OpenAI, with clone-only style snippets.
 */

import { DateTime } from "luxon";
import { createRequire } from "module";
import path from "path";
import { userMemory } from "../store/userMemory.js";
import { getRequired } from "../utils/env.js";
import logger from "../utils/logger.js";

// Use createRequire to load JSON in ESM without import assertions
const require = createRequire(import.meta.url);

/**
 * Persona configuration shape loaded from JSON.
 */
interface PersonaConfig {
  /** Unique ID for the clone user. */
  cloneUserId: string;
  /** Base system prompt describing the assistant persona. */
  baseDescription: string;
  /** Guide for formatting markdown appropriately. */
  markdownGuide: string;
}

let persona: PersonaConfig;
try {
  persona = require(
    path.resolve(process.cwd(), "src/config/persona.json")
  ) as PersonaConfig;
  logger.debug(
    `[characterService] Loaded persona config (cloneUserId=${persona.cloneUserId})`
  );
} catch (err) {
  logger.error("[characterService] Failed to load persona config:", err);
  throw err;
}

/** ID of the clone user, used to apply clone-specific behaviours. */
export const cloneUserId = persona.cloneUserId;
/** Markdown formatting guide appended to system prompts. */
export const markdownGuide = persona.markdownGuide;

/**
 * Escape TeX sequences so they render correctly within Discord markdown by wrapping in backticks.
 *
 * @param text - Raw text potentially containing TeX bracket sequences.
 * @returns Input text with TeX sequences escaped for Discord.
 */
export function fixMathFormatting(text: string): string {
  logger.debug("[characterService] fixMathFormatting invoked");
  const escaped = text.replace(/\\\[[^\]]*\\\]/g, (m) => `\`${m}\``);
  return escaped;
}

/**
 * Builds the full system prompt for OpenAI chat by combining:
 * - The base persona description
 * - Clone-only style snippet from recent memory, if applicable
 * - Current timestamp
 * - The markdown formatting guide
 *
 * @param userId - Optional Discord user ID to include clone-specific styling.
 * @returns Promise resolving to the fully constructed system prompt string.
 */
export async function getCharacterDescription(
  userId?: string
): Promise<string> {
  logger.debug(
    `[characterService] Generating system prompt for userId=${userId}`
  );

  // Start with the base persona description
  const usePersona = getRequired("USE_PERSONA") === "true";
  let description = usePersona ? persona.baseDescription : "";

  // Append style snippet if clone user AND persona enabled
  if (usePersona && userId === cloneUserId) {
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

  // Append the current timestamp using the system's locale
  const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  const now = DateTime.now()
    .setLocale(systemLocale)
    .toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);
  logger.debug(`[characterService] Current timestamp: ${now}`);
  description += `\n\n_Current time: ${now}_`;

  // Append markdown guide
  description += `\n\n${persona.markdownGuide}`;

  // Escape any TeX sequences before returning
  const finalPrompt = fixMathFormatting(description);
  logger.debug(
    `[characterService] Final system prompt length=${finalPrompt.length}`
  );
  return finalPrompt;
}
