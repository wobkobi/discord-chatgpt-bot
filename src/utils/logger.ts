import { TransformableInfo } from "logform";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format in a Minecraft-like style: [HH:mm:ss] [LEVEL]: message
const logFormat = printf((info: TransformableInfo) => {
  const { level, message, timestamp, stack } = info;
  return `[${timestamp}] [${level.toUpperCase()}]: ${stack || message}`;
});

// Combined logs: stored in the root logs folder with filename as the date, and a symlink "latest.log"
const combinedRotateTransport = new DailyRotateFile({
  filename: "logs/%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxSize: "10m",
  maxFiles: "14d",
  createSymlink: true,
  symlinkName: "latest.log",
});

// Error logs: stored in the "logs/error" folder with filename as the date, and a symlink "error-latest.log"
const errorRotateTransport = new DailyRotateFile({
  filename: "logs/error/%DATE%.log",
  datePattern: "YYYY-MM-DD",
  level: "error",
  maxSize: "10m",
  maxFiles: "14d",
  createSymlink: true,
  symlinkName: "error-latest.log",
});

// Create the logger instance with console and rotating file transports.
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
