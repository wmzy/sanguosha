// server/app.ts — 组合根。
// 从原 678 行文件拆分:共享状态→registry、REST 路由→rest、WS 处理→ws。
// 本文件保留:Hono 实例 + 全局中间件 + 生命周期(闲置清理/启动恢复)。

import { Hono } from 'hono';
import { cors, requestLogger, errorHandler, rateLimit } from './middleware';
import { gameSessions } from './registry';
import { applyRestRoutes } from './rest';
import { GameSession } from './session';
import { createLogger } from './logger';
import { listPersistedRooms, loadRoom, deletePersistedRoom, restoreFromLog } from './persistence';
import { normalizeRoomConfig } from './protocol';
import { addRoom, getRoom, type Room } from './room';
import { cleanupIdleRooms } from './cleanup';
import { initRoomStore, loadAllRoomsFromDb, deleteRoomFromDb } from './roomStore';

const log = createLogger('ws');

const app = new Hono();
app.use('*', cors);
app.use('*', requestLogger);
app.use('*', rateLimit);
app.onError(errorHandler);

// REST 路由注册到主 app 实例(中间件照常生效)
applyRestRoutes(app);

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** 启动服务器生命周期副作用:闲置清理定时器 + 持久化房间恢复。
 *  必须由运行时入口(index.ts 独立运行 / vite-plugin configureServer dev 模式)显式调用。
 *  不能放在模块级: vite build 时加载 vite.config → import app 也会触发副作用,
 *  导致 build 进程意外启动游戏 session 并反复写持久化文件。 */
export function startServerLifecycle(): void {
  setInterval(cleanupIdleRooms, CLEANUP_INTERVAL_MS).unref();
  void (async () => {
    await initRoomStore();
    await restoreNormalRoomsFromDb();
    await restorePersistedRooms().catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      log.error('restorePersistedRooms failed', { error: e.stack ?? String(e) });
    });
    // 恢复后立即清理僵尸房间(无 seats 的进行中房间),避免它们出现在房间列表。
    cleanupIdleRooms();
  })();
}

/** 从 DB 恢复普通房间元数据。快闪房间不入库,无需恢复。 */
async function restoreNormalRoomsFromDb(): Promise<void> {
  const rows = await loadAllRoomsFromDb();
  log.info(`启动恢复：发现 ${rows.length} 个普通房间记录`);
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  for (const row of rows) {
    // 超过 1 小时且非进行中的普通房间,清理
    if (now - row.updatedAt > ONE_HOUR && row.status !== '进行中') {
      log.info(`跳过过期普通房间 ${row.id}（最后更新: ${new Date(row.updatedAt).toISOString()}）`);
      await deleteRoomFromDb(row.id);
      continue;
    }
    const room: Room = {
      id: row.id,
      name: row.name,
      players: new Map(),
      maxPlayers: row.maxPlayers,
      status: row.status as Room['status'],
      hostId: row.hostId,
      readyPlayers: new Set(),
      roomType: 'normal',
      isDebug: row.isDebug,
      config: row.config,
      spectators: new Map(),
      viewGrants: new Map(),
      pendingViewRequests: new Map(),
      chatUsage: new Map(),
      chatHistory: [],
      seats: Array(row.maxPlayers).fill(null),
      pendingSeatSwaps: new Map(),
    };
    addRoom(room);
    log.info(`恢复普通房间 ${row.id}（${row.name}，状态: ${row.status}）`);
  }
}

async function restorePersistedRooms(): Promise<void> {
  const roomIds = await listPersistedRooms();
  log.info(`启动恢复：发现 ${roomIds.length} 个持久化房间`);
  // skill 注册表是 state-bound(WeakMap 外挂),每个房间的 state 自带独立注册表,
  // 无需启动时清理全局表。bootstrap 会为每个 state 注册各自的技能实例。
  // 清理超过 1 小时的房间(所有类型都不跨重启长期保留)
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  for (const roomId of roomIds) {
    try {
      const persisted = await loadRoom(roomId);
      if (!persisted) continue;
      // 用 startedAt(游戏开始时间)判定过期,不用文件 mtime:
      // restoreState 后 pending slot 定时器会反复触发 saveRoom 刷新 mtime,
      // 导致 mtime 永远是最近的,过期检查失效。
      const startedAt = persisted.state?.startedAt;
      if (startedAt && now - startedAt > ONE_HOUR) {
        log.info(`跳过过期房间 ${roomId}（游戏开始: ${new Date(startedAt).toISOString()}）`);
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
      // 如果房间已从 DB 恢复(normal 房间), 复用已存在的 Room 对象;
      // 否则新建 Room(quick 房间重启后丢失, 仅 JSON 游戏状态能恢复)
      // 从持久化数据恢复座次映射(playerId → seat index)。
      // 旧数据无 seats 字段时退回全 null(玩家无法重连,依赖安全网清理)。
      const restoredSeats = persisted.seats ?? Array(persisted.maxPlayers || state.players.length).fill(null);
      const existingRoom = getRoom(roomId);
      const room: Room = existingRoom ?? {
        id: roomId,
        name: persisted.roomName || `恢复-${roomId}`,
        players: new Map(),
        maxPlayers: persisted.maxPlayers || state.players.length,
        status: '进行中',
        hostId: persisted.hostId,
        readyPlayers: new Set(),
        roomType: persisted.debug ? 'quick' : 'quick',
        isDebug: persisted.debug,
        config: restoredConfig,
        spectators: new Map(),
        viewGrants: new Map(),
        pendingViewRequests: new Map(),
        chatUsage: new Map(),
        chatHistory: [],
        seats: restoredSeats,
        pendingSeatSwaps: new Map(),
      };
      if (!existingRoom) addRoom(room);
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

export default app;
