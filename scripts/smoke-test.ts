// scripts/smoke-test.ts
// No-Discord smoke test: loads every slash command the way src/index.ts does and checks
// the pure logic that would otherwise need a live bot (maths extraction, private-host
// blocking, memory trimming, encryption, emoji resolution, GIF slugs, API failure
// classification). Needs no token and makes no network calls. Exits 1 on any failure.
//
//   npx tsx scripts/smoke-test.ts

import "./smoke-env";

import { FORMULA_RE, KNOWN_FAILURES, toApiFailure } from "@/services/replyService";
import { replaceEmojiShortcodes } from "@/utils/discordHelpers";
import { decrypt, encrypt } from "@/utils/fileUtils";
import { slugToQuery } from "@/utils/gifResolver";
import { trimMemory } from "@/utils/trimMemory";
import { isPrivateHost } from "@/utils/urlExtractor/extractInlineImages";
import { Guild, SlashCommandBuilder } from "discord.js";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

/** Outcome of one assertion. */
interface CheckResult {
  group: string;
  name: string;
  pass: boolean;
}

/** Repository root, derived from this file's location. */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const results: CheckResult[] = [];

/**
 * Record and print the outcome of a single assertion.
 * @param group - Section the check belongs to.
 * @param name - Human-readable description of the check.
 * @param pass - Whether the assertion held.
 */
function check(group: string, name: string, pass: boolean): void {
  results.push({ group, name, pass });
  const icon = pass ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  console.log(`  ${icon} ${DIM}${group}${RESET} ${name}`);
}

/**
 * Run a function expected to throw.
 * @param fn - Function under test.
 * @returns True when the function threw.
 */
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

/**
 * Load every module in src/commands by dynamic import, as the loader in src/index.ts
 * does, and verify each exports a named SlashCommandBuilder and an execute function.
 * OWNER_ID and OPENAI_API_KEY are unset here, so this also proves no command reads
 * them at import time.
 */
async function checkCommandsLoad(): Promise<void> {
  const dir = path.join(ROOT, "src", "commands");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  check("commands", "command files found", files.length > 0);
  for (const file of files) {
    let ok = false;
    try {
      const mod = (await import(pathToFileURL(path.join(dir, file)).href)) as {
        data?: unknown;
        execute?: unknown;
      };
      ok =
        mod.data instanceof SlashCommandBuilder &&
        mod.data.name.length > 0 &&
        typeof mod.execute === "function";
    } catch (err: unknown) {
      console.error(`    ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
    check("commands", `${file} exports data + execute`, ok);
  }
}

/**
 * Verify {@link FORMULA_RE} picks up every LaTeX form and leaves ordinary code fences in
 * the reply.
 */
function checkFormulaRegex(): void {
  const code = "Here:\n```js\nconst x = 1;\n```";
  check("maths", "```js block survives the LaTeX strip", code.replace(FORMULA_RE, "") === code);

  const reply = "a $$x^2$$ b \\[a\\] c \\(b\\) d\n```latex\n\\frac{1}{2}\n```";
  const found = Array.from(reply.matchAll(FORMULA_RE), (m) =>
    (m[1] || m[2] || m[3] || m[4] || "").trim(),
  );
  check(
    "maths",
    "$$, \\[ \\], \\( \\) and ```latex are all matched",
    found.join("|") === "x^2|a|b|\\frac{1}{2}",
  );
}

/** Verify {@link isPrivateHost} blocks loopback, LAN and link-local hosts only. */
function checkPrivateHosts(): void {
  const blocked = ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1", "[::1]"];
  check("ssrf", "loopback and LAN hosts are private", blocked.every(isPrivateHost));
  check("ssrf", "fe80:: link-local is private", isPrivateHost("[fe80::1]"));
  check(
    "ssrf",
    "public hosts are allowed",
    !isPrivateHost("example.com") && !isPrivateHost("8.8.8.8"),
  );
}

/** Verify {@link trimMemory} keeps the newest entries within the cap. */
function checkTrimMemory(): void {
  const entry = (content: string, timestamp: number): { content: string; timestamp: number } => ({
    content,
    timestamp,
  });
  const kept = trimMemory([entry("aaaa", 1), entry("bbbb", 2), entry("cccc", 3)], 10);
  check(
    "memory",
    "oldest entries are dropped first",
    kept.map((e) => e.timestamp).join() === "2,3",
  );

  const big = trimMemory([entry("old", 1), entry("x".repeat(20), 2)], 10);
  check(
    "memory",
    "an oversized newest entry is truncated, not dropped",
    big.length === 1 && big[0]?.timestamp === 2 && big[0].content.length === 10,
  );
  check("memory", "empty input gives []", trimMemory([]).length === 0);
}

/** Verify the AES-GCM round trip and that a tampered ciphertext fails authentication. */
function checkEncryption(): void {
  const plain = "secret memory ✓";
  const enc = encrypt(plain);
  check("crypto", "encrypt/decrypt round trip", decrypt(enc) === plain);

  const bytes = Buffer.from(enc, "base64");
  const last = bytes.length - 1;
  bytes[last] = (bytes[last] ?? 0) ^ 0xff;
  check(
    "crypto",
    "a tampered byte fails to decrypt",
    throws(() => decrypt(bytes.toString("base64"))),
  );
}

/** Verify {@link replaceEmojiShortcodes} against a minimal fake guild. */
function checkEmojiShortcodes(): void {
  const emoji = { name: "britishCat", toString: () => "<:britishCat:1>" };
  const guild = { emojis: { cache: [emoji] } } as unknown as Guild;

  check(
    "emoji",
    ":britishcat: resolves case-insensitively",
    replaceEmojiShortcodes("hi :britishcat:", guild) === "hi <:britishCat:1>",
  );
  check(
    "emoji",
    "a stale tag is re-resolved by name",
    replaceEmojiShortcodes("<:britishCat:999>", guild) === "<:britishCat:1>",
  );
  check(
    "emoji",
    "an unknown :nope: is dropped",
    replaceEmojiShortcodes("ok :nope:", guild) === "ok",
  );
  check(
    "emoji",
    "clock times survive",
    replaceEmojiShortcodes("at 10:30:45", guild) === "at 10:30:45",
  );
}

/** Verify {@link slugToQuery} strips the ID and -gif suffix from a page slug. */
function checkGifSlug(): void {
  check(
    "gif",
    "slug becomes search keywords",
    slugToQuery("happy-dance-gif-12345") === "happy dance",
  );
}

/** Verify {@link toApiFailure} and {@link KNOWN_FAILURES} classify common OpenAI errors. */
function checkFailureClassification(): void {
  const reasonFor = (err: unknown): string | undefined => {
    const failure = toApiFailure(err);
    return KNOWN_FAILURES.find((entry) => entry.test(failure))?.reason;
  };
  check(
    "openai",
    "429 insufficient_quota is billing, not rate limiting",
    reasonFor({ status: 429, code: "insufficient_quota" }) === "out of credit",
  );
  check("openai", "plain 429 is rate limiting", reasonFor({ status: 429 }) === "rate limited");
  check("openai", "401 is a rejected key", reasonFor({ status: 401 }) === "rejected API key");
  check(
    "openai",
    "socket code on cause is a network fault",
    reasonFor({ message: "fetch failed", cause: { code: "ECONNRESET" } }) === "network fault",
  );
  check("openai", "a non-object is unclassified", reasonFor("boom") === undefined);
}

void (async () => {
  let exitCode = 0;
  try {
    await checkCommandsLoad();
    checkFormulaRegex();
    checkPrivateHosts();
    checkTrimMemory();
    checkEncryption();
    checkEmojiShortcodes();
    checkGifSlug();
    checkFailureClassification();

    const failed = results.filter((r) => !r.pass).length;
    if (failed === 0) {
      console.log(`\n  ${GREEN}✓ all ${results.length} checks passed${RESET}\n`);
    } else {
      console.log(`\n  ${RED}✗ ${failed} of ${results.length} checks failed${RESET}\n`);
      exitCode = 1;
    }
  } catch (err) {
    console.error("\nFatal error:", err);
    exitCode = 1;
  }
  process.exit(exitCode);
})();
