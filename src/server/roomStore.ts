// src/server/roomStore.ts — 房间元数据持久化层。
// 普通房间(normal)元数据通过 Drizzle + PGLite 持久化;快速房间(quick)不入库。
// 采用回调注册模式:room.ts 的 roomChangeHandler 触发 → roomStore fire-and-forget 写入。
import { eq } from 'drizzle-orm';
import { join } from 'node:path';
import { createDB, migrateDB, type DB } from '../db';
import { rooms, type RoomRow } from '../db/schema';
import { setRoomChangeHandler } from './room';
import type { Room } from './room';
import { createLogger } from './logger';
import { register as registerLifecycle } from './lifecycles';

const log = createLogger('roomStore');

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

/** 初始化 DB 连接 + 运行迁移 + 注册 room.ts 变更回调。幂等。 */
export async function initRoomStore(dataDir?: string): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    dbHandle = await createDB({ driver: 'pglite', dataDir: dataDir ?? DATA_DIR });
    await migrateDB(dbHandle);
    // 注册回调:room.ts 房间变更 → 同步到 DB
    setRoomChangeHandler((room, action) => {
      if (room.roomType !== 'normal') return; // 仅持久化普通房间
      if (action === 'delete') {
        void deleteRoomFromDb(room.id).catch((err) => {
          log.error(`deleteRoomFromDb failed for ${room.id}`, { error: String(err) });
        });
      } else {
        void upsertRoomToDb(room).catch((err) => {
          log.error(`upsertRoomToDb failed for ${room.id}`, { error: String(err) });
        });
      }
    });
    log.info('roomStore initialized');
  })();
  return initPromise;
}

/** 关闭 DB 连接(测试/进程退出时)。 */
export async function closeRoomStore(): Promise<void> {
  if (dbHandle) {
    await dbHandle.close();
    dbHandle = null;
  }
  initPromise = null;
  setRoomChangeHandler(null);
}

export function isRoomStoreReady(): boolean {
  return dbHandle !== null;
}

/** Room → DB 行转换。 */
function roomToRow(room: Room, now: number) {
  return {
    id: room.id,
    name: room.name,
    roomType: room.roomType,
    isDebug: room.isDebug === true,
    maxPlayers: room.maxPlayers,
    hostId: room.hostId,
    status: room.status,
    config: room.config,
    createdAt: now,
    updatedAt: now,
  };
}

/** 插入或更新普通房间。 */
export async function upsertRoomToDb(room: Room): Promise<void> {
  if (!dbHandle) return;
  const now = Date.now();
  const row = roomToRow(room, now);
  await dbHandle.db
    .insert(rooms)
    .values(row)
    .onConflictDoUpdate({
      target: rooms.id,
      set: {
        name: row.name,
        maxPlayers: row.maxPlayers,
        hostId: row.hostId,
        status: row.status,
        config: row.config,
        updatedAt: now,
      },
    });
}

/** 从 DB 删除房间记录。 */
export async function deleteRoomFromDb(roomId: string): Promise<void> {
  if (!dbHandle) return;
  await dbHandle.db.delete(rooms).where(eq(rooms.id, roomId));
}

/** 从 DB 加载所有普通房间元数据(启动恢复用)。 */
export async function loadAllRoomsFromDb(): Promise<RoomRow[]> {
  if (!dbHandle) return [];
  return await dbHandle.db.select().from(rooms);
}
