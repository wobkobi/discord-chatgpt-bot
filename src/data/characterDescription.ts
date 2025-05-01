// src/data/characterDescription.ts

import { readFileSync } from "fs";
import { DateTime } from "luxon";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { userMemory } from "../memory/userMemory.js";

// 1) load and parse persona.json synchronously
const __dirname = dirname(fileURLToPath(import.meta.url));
const personaRaw = readFileSync(join(__dirname, "persona.json"), "utf8");
const persona = JSON.parse(personaRaw) as {
  cloneUserId: string;
  baseDescription: string;
  markdownGuide: string;
};

// 2) export cloneUserId & markdownGuide for use elsewhere
export const cloneUserId = persona.cloneUserId;
export const markdownGuide = persona.markdownGuide;

// 3) helper to escape TeX sequences for Discord
export function fixMathFormatting(text: string): string {
  return text.replace(/(\[[^\]]*\\[^\]]*\])/g, (m) => `\`${m}\``);
}

/**
 * Builds the system prompt: baseDescription + optional clone style +
 * current timestamp + markdownGuide.
 */
export async function getCharacterDescription(
  userId?: string
): Promise<string> {
  let description = persona.baseDescription;

  if (userId === cloneUserId) {
    const entries = userMemory.get(userId) || [];
    const style =
      entries.length === 0
        ? "Not enough data to learn your personality."
        : entries
            .slice(-5)
            .map((e) => e.content)
            .join(" ")
            .slice(0, 150);
    description += `\n\nAs a clone, your recent style: ${style}`;
  }

  const now = DateTime.now().toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);
  description += `\n\n_Current time: ${now}_\n\n${markdownGuide}`;

  // wrap any [ ... \ ] math bits in backticks
  return fixMathFormatting(description);
}
