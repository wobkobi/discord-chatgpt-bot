// scripts/smoke-env.ts
// Environment for the smoke test. It must be the first import of smoke-test.ts: ESM
// evaluates imports in order before any module body runs, so this has to load before
// anything that reads process.env.
//
// env.ts is imported here first so its dotenv.config() runs now, and a local .env can
// then be overridden. Secrets are removed to prove the modules import without them,
// ENCRYPTION_KEY is replaced so the round-trip check never uses the real key, and the log
// level is raised so the expected "not configured" warnings do not bury the results.

import "@/utils/env";

for (const key of ["BOT_TOKEN", "OWNER_ID", "OPENAI_API_KEY", "GIPHY_API_KEY"]) {
  delete process.env[key];
}
process.env.ENCRYPTION_KEY = "smoke-test-key";
process.env.LOG_LEVEL = "error";
