import fs from "fs";
import { TransformableInfo } from "logform";
import path from "path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Ensure log directories exist.
const logsDir = path.join(process.cwd(), "logs");
const errorDir = path.join(logsDir, "error");

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
if (!fs.existsSync(errorDir)) {
  fs.mkdirSync(errorDir, { recursive: true });
}

// Custom log format: [HH:mm:ss] [LEVEL]: message
const logFormat = printf((info: TransformableInfo) => {
  const { level, message, timestamp, stack } = info;
  return `[${timestamp}] [${level.toUpperCase()}]: ${stack || message}`;
});

// Combined logs transport: files stored in logs folder with filenames like "2025-04-04.log"
// The symlink "latest.log" (in the logs folder) will point to the current log file.
const combinedRotateTransport = new DailyRotateFile({
  dirname: logsDir,
  filename: "%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxSize: "10m",
  maxFiles: "14d",
  createSymlink: true,
  symlinkName: path.join(logsDir, "latest.log"),
});

// Error logs transport: files stored in logs/error folder with filenames like "2025-04-04.log"
// The symlink "error-latest.log" (in the error folder) will point to the current error log file.
const errorRotateTransport = new DailyRotateFile({
  dirname: errorDir,
  filename: "%DATE%.log",
  datePattern: "YYYY-MM-DD",
  level: "error",
  maxSize: "10m",
  maxFiles: "14d",
  createSymlink: true,
  symlinkName: path.join(errorDir, "error-latest.log"),
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    timestamp({ format: "HH:mm:ss" }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: "HH:mm:ss" }),
        errors({ stack: true }),
        logFormat
      ),
    }),
    errorRotateTransport,
    combinedRotateTransport,
  ],
});

export default logger;
