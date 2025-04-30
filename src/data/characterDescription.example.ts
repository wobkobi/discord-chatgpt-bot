import { DateTime } from "luxon";
import { userMemory } from "../memory/userMemory.js";

// Hard-coded clone target user ID
export const cloneUserId = "1234567890";

/**
 * Wraps math expressions (text within square brackets containing a backslash)
 * in inline code formatting so that Discord renders them correctly.
 */
export function fixMathFormatting(text: string): string {
  return text.replace(/(\[[^\]]*\\[^\]]*\])/g, (match) => `\`${match}\``);
}

/**
 * Applies Discord markdown formatting to the provided text.
 */
function applyDiscordMarkdownFormatting(text: string): string {
  return fixMathFormatting(text);
}

/**
 * A handy Discord‐Markdown cheat-sheet that can be injected into prompts.
 */
export const markdownGuide = [
  "```md",
  "Discord Markdown Formatting Guide:",
  "",
  "**Text Formatting**",
  "- Italics: *italics* or _italics_",
  "- Underline italics: __*underline italics*__",
  "- Bold: **bold**",
  "- Underline bold: __**underline bold**__",
  "- Bold italics: ***bold italics***",
  "- Underline bold italics: __***underline bold italics***__",
  "- Underline: __underline__",
  "- Strikethrough: ~~Strikethrough~~",
  "",
  "**Organizational Formatting**",
  "- Headers: # Header, ## Subheader, ### Subsubheader",
  "- Subtext: -# subtext",
  "- Masked links: [label](https://example.com)",
  "- Unordered lists: - item or * item",
  "- Ordered lists: 1. item",
  "",
  "**Code Blocks**",
  "- Inline code: `code`",
  "- Multiline code block:",
  "```js",
  "code line 1",
  "code line 2",
  "```",
  "",
  "**Block Quotes**",
  "- Single-line: > quote",
  "- Multi-line: >>>",
  "  quote line 1",
  "  quote line 2",
  "",
  "**Supported Code Block Languages**",
  "- asciidoc, autohotkey, bash, coffeescript, cpp (C++), cs (C#), css,",
  "  diff, fix, glsl, ini, json, md (markdown), ml, prolog, ps, py,",
  "  tex, xl, xml, yaml",
  "```",
].join("\n");

/**
 * Analyzes recent user memory entries to produce a brief summary of the user's style.
 */
async function analyzeUserStyle(userId: string): Promise<string> {
  const entries = userMemory.get(userId) || [];
  if (entries.length === 0) {
    return "Not enough data to learn your personality.";
  }
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
 * Includes a personality profile, an optional clone style summary,
 * the current time, and an appended markdown guide section.
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

  // Append current timestamp
  const currentDateTime = DateTime.now().toLocaleString(
    DateTime.DATETIME_MED_WITH_SECONDS
  );
  description += `\n\n_Current time: ${currentDateTime}_`;

  // Always inject the Discord Markdown guide at the end
  description += `\n\n${markdownGuide}`;

  return applyDiscordMarkdownFormatting(description);
}
