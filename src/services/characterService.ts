import { DateTime } from "luxon";
import { createRequire } from "module";
import path from "path";
import { userMemory } from "../store/userMemory.js";

// use createRequire to load JSON in ESM without import assertions
const require = createRequire(import.meta.url);
// always load the source persona.json so both dev and build pick up the same file
const persona = require(
  path.resolve(process.cwd(), "src/config/persona.json")
) as {
  cloneUserId: string;
  baseDescription: string;
  markdownGuide: string;
};

// persona.json provides: cloneUserId, baseDescription, markdownGuide
export const cloneUserId = persona.cloneUserId;
export const markdownGuide = persona.markdownGuide;

/**
 * Escape any TeX sequences so they render correctly within Discord markdown.
 */
export function fixMathFormatting(text: string): string {
  return text.replace(/(\\\[[^\]]*\\\\[^\]]*\\\])/g, (m) => `\`${m}\``);
}

/**
 * Build the full system prompt by combining the base description,
 * optional clone-style snippet, current timestamp, and the markdown guide.
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

  return fixMathFormatting(description);
}
