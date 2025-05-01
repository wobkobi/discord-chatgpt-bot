/**
 * @file src/services/characterService.ts
 * @description Loads persona configuration and constructs the system prompt for the AI, including clone-specific styling, timestamp, and markdown guidelines.
 */

import { DateTime } from "luxon";
import { createRequire } from "module";
import path from "path";
import { userMemory } from "../store/userMemory.js";

// Use createRequire to load JSON in ESM without import assertions
const require = createRequire(import.meta.url);

/**
 * Persona configuration loaded from JSON, containing clone ID, base description, and markdown guide.
 */
const persona = require(
  path.resolve(process.cwd(), "src/config/persona.json")
) as {
  /** Unique ID for the clone user. */
  cloneUserId: string;
  /** Base system prompt describing the assistant persona. */
  baseDescription: string;
  /** Guide for formatting markdown to follow. */
  markdownGuide: string;
};

/** ID of the clone user, used to apply clone-specific behaviors. */
export const cloneUserId = persona.cloneUserId;

/** Markdown formatting guide appended to system prompts. */
export const markdownGuide = persona.markdownGuide;

/**
 * Escape TeX sequences so they render correctly within Discord markdown by wrapping in backticks.
 *
 * @param text - The raw text potentially containing TeX bracket sequences.
 * @returns The input text with any TeX sequences escaped for Discord.
 */
export function fixMathFormatting(text: string): string {
  return text.replace(/(\\\[[^\]]*\\\\\[[^\]]*\\\])/g, (m) => `\`${m}\``);
}

/**
 * Builds the full system prompt for OpenAI chat by combining:
 * - The base persona description
 * - For the clone user: a snippet of recent memory-derived style
 * - The current timestamp
 * - The markdown formatting guide
 *
 * @param userId - Optional Discord user ID to check for clone-specific styling.
 * @returns A Promise resolving to the fully constructed system prompt string.
 */
export async function getCharacterDescription(
  userId?: string
): Promise<string> {
  // Start with the base persona description
  let description = persona.baseDescription;

  // If this is the clone user, append a summary of recent style
  if (userId === cloneUserId) {
    const entries = userMemory.get(userId) || [];
    const styleSnippet =
      entries.length === 0
        ? "Not enough data to learn your personality."
        : entries
            .slice(-5)
            .map((e) => e.content)
            .join(" ")
            .slice(0, 150);
    description += `\n\nAs a clone, your recent style: ${styleSnippet}`;
  }

  // Append the current timestamp
  const now = DateTime.now().toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);
  description += `\n\n_Current time: ${now}_`;

  // Add the markdown guide at the end
  description += `\n\n${markdownGuide}`;

  // Escape any TeX sequences for Discord
  return fixMathFormatting(description);
}
