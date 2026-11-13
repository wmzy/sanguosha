// server/logger.ts — 轻量级结构化日志

/** thrown 值归一化为 Error:非 Error 值(字符串/对象等)包装为 new Error(String(err)),
 *  供 catch 块统一取 stack/message。 */
export function normalizeError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

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
      // eslint-disable-next-line no-console
      if (shouldLog('debug')) console.log(formatMessage('debug', context, message, data));
    },
    info(message: string, data?: unknown) {
      // eslint-disable-next-line no-console
      if (shouldLog('info')) console.log(formatMessage('info', context, message, data));
    },
    warn(message: string, data?: unknown) {
      if (shouldLog('warn')) console.warn(formatMessage('warn', context, message, data));
    },
    error(message: string, data?: unknown) {
      if (shouldLog('error')) console.error(formatMessage('error', context, message, data));
    },
    /** error 日志 + thrown 值归一化:等价于 catch 块里的三行样板
     *  `const e = normalizeError(err); log.error(msg, { error: e.stack ?? String(e) })`,
     *  载荷格式({ error: stack })与原样板逐字一致。 */
    err(message: string, err: unknown) {
      const e = normalizeError(err);
      if (shouldLog('error')) {
        console.error(formatMessage('error', context, message, { error: e.stack ?? String(e) }));
      }
    },
  };
}
