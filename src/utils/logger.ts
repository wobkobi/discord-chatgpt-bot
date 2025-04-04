import { TransformableInfo } from "logform";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format in a Minecraft-like style: [HH:mm:ss] [LEVEL]: message
const logFormat = printf((info: TransformableInfo) => {
  const { level, message, timestamp, stack } = info;
  return `[${timestamp}] [${level.toUpperCase()}]: ${stack || message}`;
});

// Daily rotate file transport for error logs.
const errorRotateTransport = new DailyRotateFile({
  filename: "logs/error-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  level: "error",
  maxSize: "10m",
  maxFiles: "14d", // Keep logs for 14 days
});

// Daily rotate file transport for combined logs.
const combinedRotateTransport = new DailyRotateFile({
  filename: "logs/combined-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxSize: "10m",
  maxFiles: "14d",
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
