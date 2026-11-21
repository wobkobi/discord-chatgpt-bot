// src/services/openaiClient.ts
// Shared OpenAI client for the message handler and slash commands, so every caller gets
// the same timeout and connection pool.

import { getRequired } from "@/utils/env";
import OpenAI from "openai";

/** Per-request timeout: two minutes rather than the SDK's 10-minute default, so a stalled call fails fast. */
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

let _client: OpenAI | undefined;

/**
 * Returns the shared OpenAI client, constructing it on first use. Lazy so that importing
 * a module that uses it never throws when OPENAI_API_KEY is missing.
 * @returns The shared client.
 * @throws {Error} If OPENAI_API_KEY is not set.
 */
export function getOpenAIClient(): OpenAI {
  _client ??= new OpenAI({
    apiKey: getRequired("OPENAI_API_KEY"),
    timeout: REQUEST_TIMEOUT_MS,
  });
  return _client;
}
