/**
 * @file src/utils/env.ts
 * @description Loads environment variables from `.env` and provides helpers to access them.
 * @remarks
 *   Environment variables are initialised on module load via `dotenv.config()`.
 */

import dotenv from "dotenv";

dotenv.config();

/**
 * Retrieve the value of a required environment variable, throwing if it is missing or empty.
 *
 * @param name – The name of the environment variable to fetch.
 * @returns The non‑empty string value of the environment variable.
 * @throws Will throw an Error if the variable is not set or is an empty string.
 */
export function getRequired(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}
