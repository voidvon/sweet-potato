import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const logsDir = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.resolve(__dirname, '..', '..', 'logs');

mkdirSync(logsDir, { recursive: true });

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === 'string' && item.length > 1200) {
        return `${item.slice(0, 1200)}...<truncated:${item.length}>`;
      }
      return item;
    }, 2);
  } catch {
    return String(value);
  }
}

export function createTraceId(prefix = 'trace') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function datedLogFileName(fileName: string) {
  const date = new Date().toISOString().slice(0, 10);
  const parsed = path.parse(fileName);
  if (parsed.dir) {
    return path.join(parsed.dir, parsed.name, `${date}${parsed.ext || '.log'}`);
  }
  return path.join(parsed.name, `${date}${parsed.ext || '.log'}`);
}

export function logToFile(fileName: string, level: LogLevel, message: string, context?: Record<string, unknown>) {
  const logPath = path.join(logsDir, datedLogFileName(fileName));
  mkdirSync(path.dirname(logPath), { recursive: true });
  const line = [
    new Date().toISOString(),
    level.toUpperCase(),
    message,
    context ? safeJson(context) : '',
  ].filter(Boolean).join(' ');
  appendFileSync(logPath, `${line}\n`, 'utf8');
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    logToFile('server.log', 'debug', message, context);
  },
  info(message: string, context?: Record<string, unknown>) {
    logToFile('server.log', 'info', message, context);
  },
  warn(message: string, context?: Record<string, unknown>) {
    logToFile('server.log', 'warn', message, context);
  },
  error(message: string, context?: Record<string, unknown>) {
    logToFile('server.log', 'error', message, context);
  },
};
