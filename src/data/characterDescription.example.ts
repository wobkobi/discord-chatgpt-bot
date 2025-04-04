import { DateTime } from "luxon";
import { userMemory } from "../memory/userMemory.js";

// If character description is based on a specific user, set their ID here, it should be able to learn from the user.
export const cloneUserId = "";

/**
 * Wraps math expressions (text within square brackets containing a backslash)
 * in inline code formatting so that Discord renders them correctly.
 *
 * @param text - The text to process.
 * @returns The text with math expressions wrapped in backticks.
 */
function fixMathFormatting(text: string): string {
  return text.replace(/(\[[^\]]*\\[^\]]*\])/g, (match) => `\`${match}\``);
}

/**
 * Applies Discord markdown formatting to the provided text.
 * If the text spans multiple lines, it wraps the entire text in a multiline code block.
 *
 * @param text - The text to format.
 * @returns The formatted text.
 */
function applyDiscordMarkdownFormatting(text: string): string {
  let formatted = fixMathFormatting(text);
  if (formatted.includes("\n")) {
    formatted = "```\n" + formatted + "\n```";
  }
  return formatted;
}

/**
 * Analyzes recent user memory entries to produce a brief summary of the user's style.
 *
 * @param userId - The ID of the user.
 * @returns A short summary or a default message if insufficient data.
 */
async function analyzeUserStyle(userId: string): Promise<string> {
  const entries = userMemory.get(userId) || [];
  if (entries.length === 0) return "Not enough data to learn your personality.";
  const recentMessages = entries
    .slice(-5)
    .map((entry) => entry.content)
    .join(" ");
  return recentMessages.length > 150
    ? recentMessages.substring(0, 150) + "..."
    : recentMessages;
}

/**
 * Returns a character description that leverages Discord markdown formatting.
 * It includes a personality profile, an optional clone style summary,
 * the current time, and an appended markdown guide section.
 *
 * @param userId - Optional user ID to tailor the description.
 * @returns The fully formatted character description.
 */
export async function getCharacterDescription(
  userId?: string
): Promise<string> {
  // Placeholder description text. Replace with a detailed personality profile as needed.
  let description =
    "Placeholder description for character. Replace this text with a detailed personality profile.";

  // Append style summary if the user is the clone.
  if (userId && userId === cloneUserId) {
    const styleSummary = await analyzeUserStyle(userId);
    description += `\n\nAs a clone of user ${cloneUserId}, your personality is influenced by them. Their speech style appears to be: ${styleSummary}`;
  }

  const currentDateTime = DateTime.now().toLocaleString(
    DateTime.DATETIME_MED_WITH_SECONDS
  );
  description += `\n\n_Current time: ${currentDateTime}_`;

  // Append a section explaining Discord markdown formatting capabilities.
  description +=
    "\n\n```md\nDiscord Markdown Formatting Capabilities:\n- Italics: *text* or _text_\n- Bold: **text**\n- Underline: __text__\n- Strikethrough: ~~text~~\n- Inline code: use a single backtick at the beginning and end, e.g. `text`\n- Multiline code blocks: wrap your text with three backticks (```), optionally specifying a language\n- Block quotes: start a line with `>`\n```";

  // Return the description formatted with Discord markdown.
  return applyDiscordMarkdownFormatting(description);
}
