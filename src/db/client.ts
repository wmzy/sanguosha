// src/db/client.ts — PGLite + Drizzle 数据库连接工厂。
// 参照 c0de-agent/src/db/client.ts: PGLite 进程内 WASM Postgres, 无需外部服务器。
import { drizzle } from 'drizzle-orm/pglite';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema';
import type { DBConfig } from './types';

/** 统一数据库句柄:Drizzle ORM 实例 + close() 清理连接。 */
type DB = {
  db: PgliteDatabase<typeof schema>;
  close(): Promise<void>;
};

/**
 * 创建数据库连接。
 * - 传 dataDir → 持久化到磁盘;省略 → 内存数据库(测试用)。
 */
async function createDB(config: DBConfig): Promise<DB> {
  const connection =
    config.dataDir && config.dataDir !== ':memory:' ? { dataDir: config.dataDir } : undefined;
  const db = drizzle({ schema, connection });
  const client = db.$client;
  return {
    db,
    async close() {
      await client.close();
    },
  };
}

export type { DB };
export { createDB };
