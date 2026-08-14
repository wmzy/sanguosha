// server/cleanup.ts — 闲置房间清理逻辑。
// 从 app.ts 抽离为独立模块:无导入副作用(无 setInterval / 磁盘恢复),
// 便于单元测试。app.ts 仅负责定时调度(setInterval 调用 cleanupIdleRooms)。
//
// 重构要点:判定逻辑和执行逻辑分离。
// classifyRoom 返回策略枚举,cleanupIdleRooms 按策略分发到 teardown 模块。

import { gameSessions } from './registry';
import { getAllRooms, getRoom } from './room';
import { destroyRoomCompletely, downgradeRoomToLobby } from './teardown';
import { register } from './lifecycles';
import { createLogger } from './logger';
import type { GameSession } from './session';

const log = createLogger('cleanup');

/** 闲置房间存活时间:无玩家连接且超过此时长未活动的会话将被回收。 */
export const IDLE_ROOM_TTL_MS = 60 * 60 * 1000;

/** 快速/debug 房间在「无任何 SSE 连接」状态下的存活时间。
 *  超过即完全销毁,不论等待中/进行中——debug 房没有真人需要重连窗口,刷新重建即可。
 *  normal 持久化房间不受此规则影响(契约:仅房主显式删除)。 */
export const DISCONNECTED_ROOM_TTL_MS = 60_000;

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

// ── 无连接快速房间回收 ──
//
// cleanupIdleRooms 的盲区:它只遍历 gameSessions,而「等待中且未开局」的 debug
// 房间根本没有 session,永远不会进入清理循环——dev server 运行数日后
// /api/rooms?type=debug 积累 44+ 死房间(玩家数 0)即由此而来。
// 本扫描直接遍历 roomList,以「players + spectators 全空」(SSE onAbort 均已
// 从 Map 删除条目)作为无连接信号,补齐这一盲区。

/** 每房间首次观察到「无任何 SSE 连接」的时间戳(roomId → 观察时刻)。
 *  有连接时清除;房间销毁/从列表消失时由扫描顺带修剪。 */
const disconnectedSince = new Map<string, number>();

register('disconnectedSince', disconnectedSince, () => {
  disconnectedSince.clear();
});

/**
 * 回收无任何 SSE 连接的快速/debug 房间:持续超过 TTL 即完全销毁
 * (走 destroyRoomCompletely,释放 session/持久化文件/DB 记录)。
 *
 * - 覆盖等待中(无 session)与进行中(有 session)两种状态;
 * - normal 房间永不进入本规则;
 * - 有任意玩家或旁观者连接时不计时(计时中重连会清零重新计)。
 *
 * @param now 当前时间戳(测试注入),默认 Date.now()
 * @param ttl 无连接存活时长(测试注入短 TTL),默认 DISCONNECTED_ROOM_TTL_MS
 * @returns 本次销毁的 roomId 列表
 */
export function cleanupDisconnectedRooms(
  now: number = Date.now(),
  ttl: number = DISCONNECTED_ROOM_TTL_MS,
): string[] {
  const destroyed: string[] = [];
  const liveIds = new Set<string>();

  for (const room of getAllRooms()) {
    liveIds.add(room.id);

    // normal 持久化房间永不自动删(优先于 isDebug 标记);其余(quick/debug)适用本规则
    if (room.roomType === 'normal') continue;

    const hasConnection = room.players.size > 0 || room.spectators.size > 0;
    if (hasConnection) {
      disconnectedSince.delete(room.id);
      continue;
    }

    // 首次观察到无连接:记录起点(计时从此刻开始,而非真实断开时刻)
    if (!disconnectedSince.has(room.id)) disconnectedSince.set(room.id, now);

    if (now - disconnectedSince.get(room.id)! >= ttl) {
      log.info(
        `回收无连接房间 ${room.id}(${room.isDebug ? 'debug' : 'quick'},${room.status},` +
          `无 SSE 连接超过 ${Math.round(ttl / 1000)}s)`,
      );
      destroyed.push(room.id);
      disconnectedSince.delete(room.id);
      void destroyRoomCompletely(room.id);
    }
  }

  // 修剪已从 roomList 消失的房间残留(房间已被其他路径销毁)
  for (const roomId of disconnectedSince.keys()) {
    if (!liveIds.has(roomId)) disconnectedSince.delete(roomId);
  }

  return destroyed;
}
