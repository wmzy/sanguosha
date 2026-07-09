// server/app.ts — 组合根。
// 从原 678 行文件拆分:共享状态→registry、REST 路由→rest、WS 处理→ws。
// 本文件保留:Hono 实例 + 全局中间件 + 生命周期(闲置清理/启动恢复),
// 并 re-export WS 入口,保持 `import app, { handleWs* } from './app'` 不变。

import { Hono } from 'hono';
import { cors, requestLogger, errorHandler, rateLimit } from './middleware';
import { gameSessions, playerRoomMap } from './registry';
import { applyRestRoutes } from './rest';
import { GameSession } from './session';
import { createLogger } from './logger';
import { listPersistedRooms, loadRoom, deletePersistedRoom, restoreFromLog } from './persistence';
import { normalizeRoomConfig } from './protocol';
import { getRoom, leaveRoom, addRoom, type Room } from './room';

// re-export WS 入口(index.ts / vite-plugin.ts 从 ./app 导入)
export { handleWsMessage, handleWsOpen, handleWsClose } from './ws';

const log = createLogger('ws');

const app = new Hono();
app.use('*', cors);
app.use('*', requestLogger);
app.use('*', rateLimit);
app.onError(errorHandler);

// REST 路由注册到主 app 实例(中间件照常生效)
applyRestRoutes(app);

// 新 ENGINE-DESIGN 不再需要 protocol-adapter(回应 action 走 ClientMessage 直接 dispatch)

const IDLE_ROOM_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function cleanupIdleRooms(): void {
  const now = Date.now();
  const stale: string[] = [];
  for (const [roomId, session] of gameSessions) {
    if (now - session.getLastActivityAt() > IDLE_ROOM_TTL_MS) {
      stale.push(roomId);
    }
  }
  for (const roomId of stale) {
    log.info(`清理闲置房间 ${roomId}`);
    const session = gameSessions.get(roomId);
    session?.destroy();
    gameSessions.delete(roomId);
    const room = getRoom(roomId);
    if (room) {
      const playerIds = [...room.players.keys()];
      for (const pid of playerIds) {
        leaveRoom(roomId, pid);
        playerRoomMap.delete(pid);
      }
    }
    for (const [pid, rid] of playerRoomMap) {
      if (rid === roomId) playerRoomMap.delete(pid);
    }
  }
}

setInterval(cleanupIdleRooms, CLEANUP_INTERVAL_MS).unref();

async function restorePersistedRooms(): Promise<void> {
  const roomIds = await listPersistedRooms();
  log.info(`启动恢复：发现 ${roomIds.length} 个持久化房间`);
  // skill 注册表是 state-bound(WeakMap 外挂),每个房间的 state 自带独立注册表,
  // 无需启动时清理全局表。bootstrap 会为每个 state 注册各自的技能实例。
  // 清理超过 1 小时没活动的房间(debug 房间不需要跨重启保留)
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  for (const roomId of roomIds) {
    try {
      const persisted = await loadRoom(roomId);
      if (!persisted) continue;
      // 跳过超时的 debug 房间
      if (
        persisted.debug &&
        persisted.state?.startedAt &&
        now - persisted.state.startedAt > ONE_HOUR
      ) {
        log.info(`跳过过期 debug 房间 ${roomId}`);
        await deletePersistedRoom(roomId);
        continue;
      }
      const state = restoreFromLog(persisted);
      // 兼容新旧 GameState 格式
      if (!state.players || !Array.isArray(state.players)) {
        log.info(`房间 ${roomId} 数据格式不兼容,跳过`);
        await deletePersistedRoom(roomId);
        continue;
      }
      // 从持久化 state.config 恢复房间配置;旧数据无 config 时用默认值
      const restoredConfig =
        state.config && typeof state.config.timeoutScale === 'number'
          ? {
              ...normalizeRoomConfig(undefined),
              timeoutScale: state.config.timeoutScale,
              name: persisted.roomName || `恢复-${roomId}`,
            }
          : { ...normalizeRoomConfig(undefined), name: persisted.roomName || `恢复-${roomId}` };
      const room: Room = {
        id: roomId,
        name: persisted.roomName || `恢复-${roomId}`,
        players: new Map(),
        maxPlayers: persisted.maxPlayers || state.players.length,
        status: '进行中',
        hostId: persisted.hostId,
        readyPlayers: new Set(),
        isDebug: persisted.debug,
        config: restoredConfig,
      };
      addRoom(room);
      const session = new GameSession(room, persisted.debug);
      await session.restoreState(state, persisted.actionLog);
      gameSessions.set(roomId, session);
      log.info(
        `恢复房间 ${roomId}（${state.players.length} 名玩家，${persisted.actionLog.length} 步操作）`,
      );
    } catch (err) {
      log.info(`房间 ${roomId} 恢复失败: ${err},删除`);
      await deletePersistedRoom(roomId);
    }
  }
}

void restorePersistedRooms().catch((err) => {
  const e = err instanceof Error ? err : new Error(String(err));
  log.error('restorePersistedRooms failed', { error: e.stack ?? String(e) });
});

export default app;
