// src/utils/logger.ts
// Winston logger with console and file transports: daily rotation for combined and
// error-only logs, each with a static "latest.log" symlink. Timestamped lines, error
// stacks included, and an audible bell on error entries.

import { LOGS_DIR, LOGS_ERROR_DIR } from "@/config/paths";
import { getOptional } from "@/utils/env";
import fs from "fs";
import { TransformableInfo } from "logform";
import path from "path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

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
  const base = `[${String(info.timestamp)}] [${info.level.toUpperCase()}]: ${String(info.stack || info.message)}`;
  return bell + base;
});

// Shared format pipeline: attaches timestamps, includes error stacks, and applies custom printf
const commonFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  logFormat,
);

// Console transport: colourised only when stdout is a real TTY
const consoleTransport = new winston.transports.Console({
  format: process.stdout.isTTY ? combine(colorize({ all: true }), commonFormat) : commonFormat,
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
