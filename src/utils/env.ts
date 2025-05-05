/**
 * @file src/utils/env.ts
 * @description Loads environment variables from `.env` and provides helpers to access them.
 * @remarks
 *   Environment variables are initialised on module load via `dotenv.config()`.
 *   Uses debug logging to trace module initialisation and variable retrieval.
 */

import dotenv from "dotenv";
import logger from "./logger.js";

dotenv.config();

/**
 * Retrieve the value of a required environment variable, throwing if it is missing or empty.
 *
 * @param name – The name of the environment variable to fetch.
 * @returns The non-empty string value of the environment variable.
 * @throws Will throw an Error if the variable is not set or is an empty string.
 */
export function getRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    const errMsg = `Missing required environment variable: ${name}`;
    logger.error(`[env] ${errMsg}`);
    throw new Error(errMsg);
  }
  return value;
}
