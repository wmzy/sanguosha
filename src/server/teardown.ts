// server/teardown.ts — 统一的房间销毁/降级逻辑。
//
// 此前 room 销毁逻辑分散在 cleanup.ts(stale 回收)、rest.ts(DELETE /leave)、
// room.ts(leaveRoom 自动销毁)中,每处实现略有不同,修一处漏三处。
// 本模块集中两个入口:
//   destroyRoomCompletely — 完全销毁(session + room + .json + DB)
//   downgradeRoomToLobby  — 降级到等待中(session + .json,保留 room/DB)
// 所有步骤幂等,允许 room/session/文件/DB 已被其他路径清理。

import { gameSessions, playerRoomMap } from './registry';
import { getRoom, leaveRoom, deleteRoom, setRoomStatus } from './room';
import { deletePersistedRoom } from './persistence';
import { deleteRoomFromDb } from './roomStore';
import { createLogger } from './logger';

const log = createLogger('teardown');

/**
 * 完全销毁房间:移除 session、清理玩家映射、删除 roomList 记录、
 * 删除 .json 持久化文件、删除 DB 元数据。
 *
 * 同步部分(删除 gameSessions/roomList 记录、清理 players)在 Promise resolve 前完成;
 * 异步部分(session.destroy 内部的 deletePersistedRoom)是 fire-and-forget。
 *
 * 用于:cleanup stale 回收、REST DELETE /api/rooms/:id、REST POST /leave(快速房间)。
 */
export async function destroyRoomCompletely(roomId: string): Promise<void> {
  // 1. 移除 session 记录 + fire-and-forget destroy
  const session = gameSessions.get(roomId);
  gameSessions.delete(roomId);
  void session?.destroy().catch((err) => {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error(`session.destroy failed for ${roomId}`, { error: e.stack ?? String(e) });
  });

  // 2. 清理玩家映射(leaveRoom 处理 room 内部状态)
  const room = getRoom(roomId);
  if (room) {
    for (const pid of [...room.players.keys()]) {
      leaveRoom(roomId, pid);
      playerRoomMap.delete(pid);
    }
  }

  // 3. 删除 roomList 记录(幂等:leaveRoom 已删则 no-op)
  deleteRoom(roomId);

  // 4. 兜底:清理任何指向该房间的残留映射(必须在 await 之前,保持同步语义)
  for (const [pid, rid] of playerRoomMap) {
    if (rid === roomId) playerRoomMap.delete(pid);
  }

  // 5. 删除持久化文件
  try {
    await deletePersistedRoom(roomId);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error(`deletePersistedRoom failed for ${roomId}`, { error: e.stack ?? String(e) });
  }

  // 6. 删除 DB 元数据(幂等:quick 房间无记录则 no-op)
  try {
    await deleteRoomFromDb(roomId);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error(`deleteRoomFromDb failed for ${roomId}`, { error: e.stack ?? String(e) });
  }

  log.info(`完全销毁房间 ${roomId}`);
}

/**
 * 重置房间状态到「等待中」:清空准备记录、座次、交换请求。
 * 纯内存操作,不涉及 session/持久化。
 */
export function resetRoomToLobby(roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  room.readyPlayers = new Set();
  room.pendingSeatSwaps.clear();
  room.seats = room.seats.map(() => null);
  setRoomStatus(roomId, '等待中');
}

/**
 * 降级房间到「等待中」:销毁 session、删除 .json、重置 room 状态。
 * 保留 roomList 记录和 DB 元数据,房主可在列表看到房间重新开局。
 *
 * 同步部分(删除 gameSessions 记录、重置 room 状态)在 Promise resolve 前完成。
 *
 * 用于:cleanup normal orphan(座次全空的进行中普通房间)。
 */
export async function downgradeRoomToLobby(roomId: string): Promise<void> {
  // 1. 移除 session 记录 + fire-and-forget destroy
  const session = gameSessions.get(roomId);
  gameSessions.delete(roomId);
  void session?.destroy().catch((err) => {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error(`session.destroy failed for ${roomId}`, { error: e.stack ?? String(e) });
  });

  // 2. 重置 room 状态
  resetRoomToLobby(roomId);

  // 3. 删除持久化文件(避免下次启动恢复出空壳 session)
  try {
    await deletePersistedRoom(roomId);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error(`deletePersistedRoom failed for ${roomId}`, { error: e.stack ?? String(e) });
  }

  log.info(`降级房间 ${roomId} 到等待中`);
}
