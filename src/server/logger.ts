// src/server/logger.ts — 服务端日志入口:shared 核心 + normalizeError/err 扩展

import { createLogger as createCoreLogger } from '../shared/logger';

/** thrown 值归一化为 Error:非 Error 值(字符串/对象等)包装为 new Error(String(err)),
 *  供 catch 块统一取 stack/message。 */
export function normalizeError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function createLogger(context: string) {
  const core = createCoreLogger(context);
  return {
    ...core,
    /** error 日志 + thrown 值归一化:等价于 catch 块里的三行样板
     *  `const e = normalizeError(err); log.error(msg, { error: e.stack ?? String(e) })`,
     *  载荷格式({ error: stack })与原样板逐字一致。 */
    err(message: string, err: unknown) {
      const e = normalizeError(err);
      core.error(message, { error: e.stack ?? String(e) });
    },
  };
}
