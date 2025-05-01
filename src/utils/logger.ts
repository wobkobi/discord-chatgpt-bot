/**
 * @file src/utils/logger.ts
 * @description Configures and exports a Winston logger with console and file transports,
 * including daily rotation for combined logs and error-specific logs.
 */

import fs from "fs";
import { TransformableInfo } from "logform";
import path from "path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

// Destructure Winston format functions for convenience
const { combine, timestamp, printf, colorize, errors } = winston.format;

/**
 * Paths for log storage: one for all logs, and a subdirectory for errors.
 */
const logsDir = path.join(process.cwd(), "logs");
const errorDir = path.join(logsDir, "error");

// Ensure the log directories exist
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(errorDir)) fs.mkdirSync(errorDir, { recursive: true });

/**
 * Custom formatting for log messages.
 * Emits timestamp, log level, message, and stack trace when present.
 */
const logFormat = printf((info: TransformableInfo) => {
  const base = `${info.timestamp} [${info.level}]: ${info.message}`;
  return info.stack ? `${base}\n${info.stack}` : base;
});

/**
 * Combined format pipeline applied to all transports.
 * - Adds timestamps
 * - Handles Error objects
 * - Applies the custom printf format
 */
const commonFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  logFormat
);

/**
 * Transport for console output, with colorized levels for readability.
 */
const consoleTransport = new winston.transports.Console({
  format: combine(colorize({ all: true }), commonFormat),
});

/**
 * Daily rotating file transport for error-level logs.
 */
const errorRotateTransport = new DailyRotateFile({
  level: "error",
  dirname: errorDir,
  filename: "error-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles: "14d",
  extension: ".log",
  symlinkName: path.join(errorDir, "error-latest.log"),
});

/**
 * Daily rotating file transport for all log levels.
 */
const combinedRotateTransport = new DailyRotateFile({
  level: process.env.LOG_LEVEL || "info",
  dirname: logsDir,
  filename: "combined-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles: "30d",
  extension: ".log",
  symlinkName: path.join(logsDir, "combined-latest.log"),
});

/**
 * The configured Winston logger instance.
 * Exposes methods: error, warn, info, verbose, debug, silly.
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: commonFormat,
  transports: [consoleTransport, errorRotateTransport, combinedRotateTransport],
});

export default logger;
