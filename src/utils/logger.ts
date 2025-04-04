import { TransformableInfo } from "logform";
import winston from "winston";

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format in a Minecraft-like style: [HH:mm:ss] [LEVEL]: message
const logFormat = printf((info: TransformableInfo) => {
  const { level, message, timestamp, stack } = info;
  return `[${timestamp}] [${level.toUpperCase()}]: ${stack || message}`;
});

// Create the logger instance with console and file transports.
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
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      format: combine(
        timestamp({ format: "HH:mm:ss" }),
        errors({ stack: true }),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
      format: combine(
        timestamp({ format: "HH:mm:ss" }),
        errors({ stack: true }),
        logFormat
      ),
    }),
  ],
});

export default logger;
