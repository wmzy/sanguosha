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
 * 清理闲置房间,返回本次被清理(从 gameSessions 移除)的 roomId 列表。
 *
 * 判定顺序(按优先级):
 * 0. **普通房间(roomType='normal')**:永不自动销毁。
 *    - zombie session(isDestroyed):仅从 gameSessions 移除 session 对象本身,
 *      保留 room/持久化文件/DB 元数据,让房主可在房间列表重新开局或显式删除。
 *    - 非 zombie session:完整保留。
 * 1. **已 destroy 的 zombie session**(快速房间,全员断线 grace 超时后遗留):
 *    无视 TTL 立即回收,否则会因 room.players 仍有(已断线的)记录而永久泄漏。
 * 2. **仍有玩家连接的房间**:游戏结束后玩家留在房间内等待「再来一局」,此时
 *    lastActivityAt 因 gameOverHandled 不再更新(onStateChange 提前返回),但只要
 *    room.players 非空,session 必须保留——绝不能把连着的玩家踢出房间。
 * 3. **无玩家连接 + 超过 TTL**:真正闲置的空房间,回收。
 *
 * 返回值包含快速房间的所有回收(zombie/闲置/僵尸),不包含普通房间的 zombie 清理
 * (普通房间仅从 gameSessions 移除 session 对象,不返回在结果中)。
 *
 * @param now 当前时间戳(测试注入),默认 Date.now()
 */
export function cleanupIdleRooms(now: number = Date.now()): string[] {
  const stale: string[] = [];
  // 普通房间的 zombie session:仅从 gameSessions 移除 session 对象本身,
  // 保留 room / 持久化文件 / DB 元数据,让房主可在房间列表看到房间并重新开局或显式删除。
  // 普通房间永不进入 stale(不自动销毁任何持久化状态)。
  const normalZombieSessions: string[] = [];
  for (const [roomId, session] of gameSessions) {
    const room = getRoom(roomId);
    // 普通房间: 不自动销毁。zombie session 单独清理,避免 session 对象泄漏。
    if (room?.roomType === 'normal') {
      if (session.isDestroyed()) normalZombieSessions.push(roomId);
      continue;
    }
    // 1. 已销毁的 zombie:立即回收(grace 超时/全员断线后遗留,room.players 可能仍非空)
    if (session.isDestroyed()) {
      stale.push(roomId);
      continue;
    }
    // 2. 仍有玩家连接:游戏结束后玩家留在房间等「再来一局」,不清理
    if (room && room.players.size > 0) continue;
    // 2b. 僵尸房间: 进行中/已结束但无玩家连接且座次全空(重启后 seats 丢失的恢复房间)。
    //     无人可重连,grace timer 因 playerNames 为空也不启动,立即回收避免泄漏。
    if (room && room.status !== '等待中' && room.seats.every((s) => s === null)) {
      stale.push(roomId);
      continue;
    }
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

  // 普通房间 zombie session: 仅移除 session 对象,保留 room/持久化文件/DB 元数据。
  // room 状态若仍为「进行中」,后续 startup 的 downgradeStaleNormalRooms 会降级为
  // 「等待中」,房主可在房间列表重新开局或显式删除房间。
  for (const roomId of normalZombieSessions) {
    log.info(`移除普通房间 zombie session ${roomId}(保留 room/持久化/DB)`);
    gameSessions.delete(roomId);
  }
  return stale;
}
