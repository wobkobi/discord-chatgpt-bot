/**
 * @file src/utils/logger.ts
 * @description Configures and exports a Winston logger with console and file transports,
 * including daily rotation for combined logs and error-specific logs, and provides a static "latest.log" symlink.
 */

import dotenv from "dotenv";
import fs from "fs";
import { TransformableInfo } from "logform";
import path from "path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

// Load environment variables for LOG_LEVEL, etc.
dotenv.config();

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Directories for logs and error logs
const logsDir = path.join(process.cwd(), "logs");
const errorDir = path.join(logsDir, "error");

// Ensure directories exist
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(errorDir)) fs.mkdirSync(errorDir, { recursive: true });

/**
 * Formats log entries with timestamp, level, and message/stack. Emits a bell on errors.
 */
const logFormat = printf((info: TransformableInfo) => {
  const bell = info.level === "error" ? "\u0007" : "";
  const base = `[${info.timestamp}] [${info.level.toUpperCase()}]: ${info.stack || info.message}`;
  return bell + base;
});

/**
 * Shared format pipeline: timestamps, error stacks, and custom printf.
 */
const commonFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  logFormat
);

/**
 * Console transport with colorized output.
 */
const consoleTransport = new winston.transports.Console({
  format: combine(colorize({ all: true }), commonFormat),
});

/**
 * Error logs: daily rotation, 14-day retention, static symlink 'latest.log'.
 */
const errorRotateTransport = new DailyRotateFile({
  level: "error",
  dirname: errorDir,
  filename: "error-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles: "14d",
  symlinkName: path.join(errorDir, "latest.log"),
});

/**
 * Combined logs: daily rotation, 30-day retention, static symlink 'latest.log'.
 */
const combinedRotateTransport = new DailyRotateFile({
  level: process.env.LOG_LEVEL || "info",
  dirname: logsDir,
  filename: "combined-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles: "30d",
  symlinkName: path.join(logsDir, "latest.log"),
});

/**
 * Singleton Winston logger instance for application-wide use.
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: commonFormat,
  transports: [consoleTransport, errorRotateTransport, combinedRotateTransport],
});

export default logger;
