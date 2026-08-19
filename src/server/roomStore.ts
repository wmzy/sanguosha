// src/server/roomStore.ts — 房间元数据持久化层。
// 普通房间(normal)元数据通过 Drizzle + PGLite 持久化;快速房间(quick)不入库。
// 采用回调注册模式:room.ts 的 roomChangeHandler 触发 → roomStore fire-and-forget 写入。
// DB 连接由 dbStore 单例拥有(auth 模块共用),本模块只做房间表的读写。
import { eq } from 'drizzle-orm';
import { rooms, type RoomRow } from '../db/schema';
import { setRoomChangeHandler } from './room';
import type { Room } from './room';
import { getSharedDb, initSharedDb, closeSharedDb } from './dbStore';
import { createLogger } from './logger';

const log = createLogger('roomStore');

let storeInitPromise: Promise<void> | null = null;

/** 初始化 DB 连接 + 运行迁移 + 注册 room.ts 变更回调。幂等。 */
export async function initRoomStore(dataDir?: string): Promise<void> {
  if (storeInitPromise) return storeInitPromise;
  storeInitPromise = (async () => {
    await initSharedDb(dataDir);
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
  return storeInitPromise;
}

/** 关闭 DB 连接(测试/进程退出时)。同时解除 room 变更回调。 */
export async function closeRoomStore(): Promise<void> {
  setRoomChangeHandler(null);
  await closeSharedDb();
  storeInitPromise = null;
}

export function isRoomStoreReady(): boolean {
  return getSharedDb() !== null;
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
    passwordHash: room.passwordHash,
    playerNames: Object.fromEntries(room.playerNames),
    createdAt: now,
    updatedAt: now,
  };
}

/** 插入或更新普通房间。 */
export async function upsertRoomToDb(room: Room): Promise<void> {
  const handle = getSharedDb();
  if (!handle) return;
  const now = Date.now();
  const row = roomToRow(room, now);
  await handle.db
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
        passwordHash: row.passwordHash,
        playerNames: row.playerNames,
        updatedAt: now,
      },
    });
}

/** 从 DB 删除房间记录。 */
export async function deleteRoomFromDb(roomId: string): Promise<void> {
  const handle = getSharedDb();
  if (!handle) return;
  await handle.db.delete(rooms).where(eq(rooms.id, roomId));
}

/** 从 DB 加载所有普通房间元数据(启动恢复用)。 */
export async function loadAllRoomsFromDb(): Promise<RoomRow[]> {
  const handle = getSharedDb();
  if (!handle) return [];
  return await handle.db.select().from(rooms);
}
