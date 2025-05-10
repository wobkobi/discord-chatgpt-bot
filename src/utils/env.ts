/**
 * @file src/utils/env.ts
 * @description Manages loading of environment variables and provides helpers to access them.
 *
 *   Call `initialiseEnv()` once at application start (e.g. in your `index.ts`) to load `.env`.
 */

import dotenv from "dotenv";

let isInitialised = false;

/**
 * Initialise environment variables by loading the `.env` file.
 * Must be called once before any `getRequired` or `getOptional` calls.
 * @param path - Optional path to your env file (defaults to “.env” in project root).
 */
export function initialiseEnv(path?: string): void {
  if (isInitialised) return;
  dotenv.config({ path });
  isInitialised = true;
}

/**
 * Retrieve the value of a required environment variable, throwing if it is missing or empty.
 * @param name – The name of the environment variable to fetch.
 * @returns The non-empty string value of the environment variable.
 * @throws Will throw an Error if the variable is not set or is an empty string,
 *         or if initialiseEnv() has not been called.
 */
export function getRequired(name: string): string {
  if (!isInitialised) {
    throw new Error(
      `Environment not initialised. Call initialiseEnv() before getRequired("${name}").`
    );
  }
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Retrieve the value of an optional environment variable, returning a default if unset.
 * @param name – The name of the environment variable to fetch.
 * @param defaultValue – The value to return if the variable is not set or is empty.
 * @returns The string value of the environment variable, or the provided default.
 */
export function getOptional(name: string, defaultValue = ""): string {
  if (!isInitialised) {
    throw new Error(
      `Environment not initialised. Call initialiseEnv() before getOptional("${name}").`
    );
  }
  const value = process.env[name];
  return value && value.trim() !== "" ? value : defaultValue;
}
