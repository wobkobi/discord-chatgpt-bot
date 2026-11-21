// src/utils/env.ts
// Loads `.env` once, when this module is first imported, and provides typed accessors.
// ESM evaluates imports before the importing module's body, so any module that imports
// these helpers can read variables at module scope without a separate initialise step.

import dotenv from "dotenv";

dotenv.config();

/**
 * Retrieve the value of a required environment variable, throwing if it is missing or empty.
 * @param name - The name of the environment variable to fetch.
 * @returns The non-empty string value of the environment variable.
 * @throws {Error} If the variable is not set or is empty.
 */
export function getRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Retrieve the value of an optional environment variable, returning a default if unset.
 * @param name - The name of the environment variable to fetch.
 * @param defaultValue - The value to return if the variable is not set or is empty.
 * @returns The string value of the environment variable, or the provided default.
 */
export function getOptional(name: string, defaultValue = ""): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : defaultValue;
}
