// server/cleanup.ts — 闲置房间清理逻辑。
// 从 app.ts 抽离为独立模块:本模块无导入副作用(无 setInterval / 磁盘恢复),
// 便于单元测试。app.ts 仅负责定时调度(setInterval 调用 cleanupIdleRooms)。

import { gameSessions, playerRoomMap } from './registry';
import { getRoom, leaveRoom, deleteRoom } from './room';
import { deletePersistedRoom } from './persistence';
import { createLogger } from './logger';

const log = createLogger('cleanup');

/** 闲置房间存活时间:无玩家连接且超过此时长未活动的会话将被回收。 */
export const IDLE_ROOM_TTL_MS = 60 * 60 * 1000;

/**
 * 清理闲置房间,返回本次被清理的 roomId 列表。
 *
 * 三条判定(按优先级):
 * 1. **已 destroy 的 zombie session**(全员断线 grace 超时后遗留):无视 TTL 立即回收,
 *    否则它会因 room.players 仍有(已断线的)记录而永久泄漏。
 * 2. **仍有玩家连接的房间**:游戏结束后玩家留在房间内等待「再来一局」,此时
 *    lastActivityAt 因 gameOverHandled 不再更新(onStateChange 提前返回),但只要
 *    room.players 非空,session 必须保留——绝不能把连着的玩家踢出房间。
 * 3. **无玩家连接 + 超过 TTL**:真正闲置的空房间,回收。
 *
 * @param now 当前时间戳(测试注入),默认 Date.now()
 */
export function cleanupIdleRooms(now: number = Date.now()): string[] {
  const stale: string[] = [];
  for (const [roomId, session] of gameSessions) {
    // 1. 已销毁的 zombie:立即回收(grace 超时/全员断线后遗留,room.players 可能仍非空)
    if (session.isDestroyed()) {
      stale.push(roomId);
      continue;
    }
    // 2. 仍有玩家连接:游戏结束后玩家留在房间等「再来一局」,不清理
    const room = getRoom(roomId);
    if (room && room.roomType === 'normal') continue; // 普通房间: 不自动销毁
    if (room && room.players.size > 0) continue;
    // 3. 无玩家连接 + 超过 TTL:闲置回收
    if (now - session.getLastActivityAt() > IDLE_ROOM_TTL_MS) {
      stale.push(roomId);
    }
  }

  for (const roomId of stale) {
    log.info(`清理闲置房间 ${roomId}`);
    const session = gameSessions.get(roomId);
    void session?.destroy();
    gameSessions.delete(roomId);
    const room = getRoom(roomId);
    if (room) {
      const playerIds = [...room.players.keys()];
      for (const pid of playerIds) {
        leaveRoom(roomId, pid);
        playerRoomMap.delete(pid);
      }
    }
    // 无玩家的空房间(启动恢复等)leaveRoom 不会被触发,显式删除避免 roomList 泄漏;
    // 有玩家的房间在上面的 leaveRoom 循环中已被清空删除,此处为幂等 no-op。
    deleteRoom(roomId);
    // 显式删持久化文件:session.destroy 是 fire-and-forget,zombie session 会
    // early-return 跳过 deletePersistedRoom,导致重启后房间复活。
    void deletePersistedRoom(roomId).catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      log.error(`cleanup: deletePersistedRoom failed for ${roomId}`, { error: e.stack ?? String(e) });
    });
    // 兜底:清理任何指向该房间的残留映射
    for (const [pid, rid] of playerRoomMap) {
      if (rid === roomId) playerRoomMap.delete(pid);
    }
  }
  return stale;
}
