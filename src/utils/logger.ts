import fs from "fs";
import { TransformableInfo } from "logform";
import path from "path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Ensure log directories exist
const logsDir = path.join(process.cwd(), "logs");
const errorDir = path.join(logsDir, "error");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(errorDir)) fs.mkdirSync(errorDir, { recursive: true });

// Custom log format: audible bell on errors, same for console and files
const logFormat = printf((info: TransformableInfo) => {
  const { level, message, timestamp, stack } = info;
  //  triggers a console bell if supported
  const bell = level === "error" ? "\u0007" : "";
  return `${bell}[${timestamp}] [${level.toUpperCase()}]: ${stack || message}`;
});

// Shared format for console and file transports
const commonFormat = combine(
  timestamp({ format: "HH:mm:ss" }),
  errors({ stack: true }),
  logFormat
);

// Rotate daily for combined logs
const combinedRotateTransport = new DailyRotateFile({
  dirname: logsDir,
  filename: "%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxSize: "10m",
  maxFiles: "14d",
  createSymlink: true,
  symlinkName: path.join(logsDir, "latest.log"),
});

// Rotate daily for error logs
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

// Console transport: colorized, uses same format
const consoleTransport = new winston.transports.Console({
  format: combine(colorize({ all: true }), commonFormat),
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: commonFormat,
  transports: [consoleTransport, errorRotateTransport, combinedRotateTransport],
});

export default logger;
