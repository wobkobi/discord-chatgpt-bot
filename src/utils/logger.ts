/**
 * @file src/utils/logger.ts
 * @description Configures and exports a Winston logger with console and file transports,
 *   including daily rotation for combined logs and error-specific logs, and provides a static "latest.log" symlink.
 * @remarks
 *   Uses timestamped formatting, error stack inclusion, and emits an audible bell on error entries.
 *   Emits debug logs to confirm initialization and transport setup.
 */

import fs from "fs";
import { TransformableInfo } from "logform";
import path from "path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { LOGS_DIR, LOGS_ERROR_DIR } from "../config/paths.js";
import { getOptional, initialiseEnv } from "./env.js";

initialiseEnv();
const { combine, timestamp, printf, colorize, errors } = winston.format;

// Ensure log directories exist
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
if (!fs.existsSync(LOGS_ERROR_DIR)) {
  fs.mkdirSync(LOGS_ERROR_DIR, { recursive: true });
}

/**
 * Custom log format: includes timestamp, uppercase level, message or error stack,
 * and emits a bell character on error level.
 */
const logFormat = printf((info: TransformableInfo) => {
  const bell = info.level === "error" ? "\u0007" : "";
  const base = `[${info.timestamp}] [${info.level.toUpperCase()}]: ${
    info.stack || info.message
  }`;
  return bell + base;
});

/**
 * Shared format pipeline: attaches timestamps, includes error stacks, and applies custom printf.
 */
const commonFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  logFormat
);

/**
 * Console transport with colourised output for readability.
 */
const consoleTransport = new winston.transports.Console({
  format: combine(colorize({ all: true }), commonFormat),
});

/**
 * Daily rotating file transport for error-level logs.
 * Retains 14 days and writes a symlink 'latest.log' to the most recent file.
 */
const errorRotateTransport = new DailyRotateFile({
  level: "error",
  dirname: LOGS_ERROR_DIR,
  filename: "error-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles: "14d",
  symlinkName: path.join(LOGS_ERROR_DIR, "latest.log"),
});

/**
 * Daily rotating file transport for combined logs at configured level.
 * Retains 30 days and writes a symlink 'latest.log' at logsDir.
 */
const combinedRotateTransport = new DailyRotateFile({
  level: getOptional("LOG_LEVEL", "info"),
  dirname: LOGS_DIR,
  filename: "combined-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles: "30d",
  symlinkName: path.join(LOGS_DIR, "latest.log"),
});

/**
 * Singleton Winston logger instance used across the application.
 * Exports console and file transports with daily rotation and error handling.
 */
const logger = winston.createLogger({
  level: getOptional("LOG_LEVEL", "info"),
  format: commonFormat,
  transports: [consoleTransport, errorRotateTransport, combinedRotateTransport],
});

export default logger;
