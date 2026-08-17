// src/server/dbStore.ts — 共享 DB 句柄单例。
// PGLite 是进程内单实例数据库;roomStore(房间元数据)与 auth(用户/会话)共用同一连接。
// 本模块拥有唯一的 DB 生命周期:init(幂等,含迁移)/get/close,并注册 lifecycles 清理。
import { join } from 'node:path';
import { createDB, migrateDB, type DB } from '../db';
import { register as registerLifecycle } from './lifecycles';
import { createLogger } from './logger';

const log = createLogger('dbStore');

const DATA_DIR = join(process.cwd(), 'data', 'db');

let dbHandle: DB | null = null;
let initPromise: Promise<void> | null = null;

registerLifecycle('dbHandle', { dbHandle }, () => {
  if (dbHandle) {
    void dbHandle.close().catch(() => {});
  }
  dbHandle = null;
  initPromise = null;
});

/** 初始化共享 DB 连接 + 运行迁移。幂等;dataDir 传 ':memory:' 或路径。 */
export async function initSharedDb(dataDir?: string): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    dbHandle = await createDB({ driver: 'pglite', dataDir: dataDir ?? DATA_DIR });
    await migrateDB(dbHandle);
    log.info('shared db initialized');
  })();
  return initPromise;
}

/** 获取共享 DB 句柄;未初始化返回 null(调用方自行降级或先 init)。 */
export function getSharedDb(): DB | null {
  return dbHandle;
}

/** 关闭共享 DB 连接(测试/进程退出时)。 */
export async function closeSharedDb(): Promise<void> {
  if (dbHandle) {
    await dbHandle.close();
    dbHandle = null;
  }
  initPromise = null;
}
