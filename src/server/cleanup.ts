// server/cleanup.ts — 闲置房间清理逻辑。
// 从 app.ts 抽离为独立模块:无导入副作用(无 setInterval / 磁盘恢复),
// 便于单元测试。app.ts 仅负责定时调度(setInterval 调用 cleanupIdleRooms)。
//
// 重构要点:判定逻辑和执行逻辑分离。
// classifyRoom 返回策略枚举,cleanupIdleRooms 按策略分发到 teardown 模块。

import { gameSessions } from './registry';
import { getRoom } from './room';
import { destroyRoomCompletely, downgradeRoomToLobby } from './teardown';
import { createLogger } from './logger';
import type { GameSession } from './session';

const log = createLogger('cleanup');

/** 闲置房间存活时间:无玩家连接且超过此时长未活动的会话将被回收。 */
export const IDLE_ROOM_TTL_MS = 60 * 60 * 1000;

type CleanupDecision =
  | { action: 'keep' }
  | { action: 'destroy' } // 完全销毁(快速房间)
  | { action: 'remove-session' } // 仅移除 session 对象(普通房间 zombie)
  | { action: 'downgrade' }; // 降级到等待中(普通房间孤儿)

/** 分类单个房间的清理决策。 */
function classifyRoom(roomId: string, session: GameSession, now: number): CleanupDecision {
  const room = getRoom(roomId);

  // ── 普通房间:永不自动销毁 ──
  if (room?.roomType === 'normal') {
    // zombie session:仅移除 session,保留 room/持久化/DB
    if (session.isDestroyed()) return { action: 'remove-session' };
    // 孤儿状态:进行中但座次全空(玩家全部离开,session 认不出任何 playerId)
    if (
      room.status === '进行中' &&
      room.players.size === 0 &&
      room.seats.every((s) => s === null)
    ) {
      return { action: 'downgrade' };
    }
    return { action: 'keep' };
  }

  // ── 快速房间 ──
  // 1. zombie session(全员断线 grace 超时后遗留):立即回收
  if (session.isDestroyed()) return { action: 'destroy' };
  // 2. 有玩家连接:保留(游戏结束后玩家留在房间等「再来一局」)
  if (room && room.players.size > 0) return { action: 'keep' };
  // 3. 僵尸房间:进行中/已结束但座次全空(重启后 seats 丢失),无人可重连
  if (room && room.status !== '等待中' && room.seats.every((s) => s === null)) {
    return { action: 'destroy' };
  }
  // 4. 无玩家 + 超过 TTL:闲置回收
  if (now - session.getLastActivityAt() > IDLE_ROOM_TTL_MS) {
    return { action: 'destroy' };
  }
  return { action: 'keep' };
}

/**
 * 清理闲置房间,返回本次完全销毁(从 gameSessions 移除并删除持久化)的 roomId 列表。
 *
 * 普通房间永不进入返回值(仅移除 zombie session 或降级,不销毁)。
 * 返回值专用于快速房间的完整回收,供调用方/测试断言。
 *
 * @param now 当前时间戳(测试注入),默认 Date.now()
 */
export function cleanupIdleRooms(now: number = Date.now()): string[] {
  const stale: string[] = [];
  const removeSessionOnly: string[] = [];
  const downgrade: string[] = [];

  for (const [roomId, session] of gameSessions) {
    const decision = classifyRoom(roomId, session, now);
    switch (decision.action) {
      case 'destroy':
        stale.push(roomId);
        break;
      case 'remove-session':
        removeSessionOnly.push(roomId);
        break;
      case 'downgrade':
        downgrade.push(roomId);
        break;
    }
  }

  // 快速房间:完全销毁
  for (const roomId of stale) {
    log.info(`清理闲置房间 ${roomId}`);
    void destroyRoomCompletely(roomId);
  }

  // 普通房间 zombie session:仅移除 session 对象,保留 room/持久化/DB
  for (const roomId of removeSessionOnly) {
    log.info(`移除普通房间 zombie session ${roomId}(保留 room/持久化/DB)`);
    gameSessions.delete(roomId);
  }

  // 普通房间孤儿状态:降级为等待中
  for (const roomId of downgrade) {
    log.info(`降级孤儿普通房间 ${roomId}(座次全空,进行中→等待中)`);
    void downgradeRoomToLobby(roomId);
  }

  return stale;
}
