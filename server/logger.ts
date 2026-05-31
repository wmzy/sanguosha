// server/logger.ts — 轻量级结构化日志

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatMessage(level: LogLevel, context: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}`;
  if (data !== undefined) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export function createLogger(context: string) {
  return {
    debug(message: string, data?: unknown) {
      if (shouldLog('debug')) console.debug(formatMessage('debug', context, message, data));
    },
    info(message: string, data?: unknown) {
      if (shouldLog('info')) console.info(formatMessage('info', context, message, data));
    },
    warn(message: string, data?: unknown) {
      if (shouldLog('warn')) console.warn(formatMessage('warn', context, message, data));
    },
    error(message: string, data?: unknown) {
      if (shouldLog('error')) console.error(formatMessage('error', context, message, data));
    },
  };
}
