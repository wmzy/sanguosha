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
import { addRoom, getRoom, setRoomStatus, type Room } from './room';
import { cleanupIdleRooms } from './cleanup';
import { initRoomStore, loadAllRoomsFromDb } from './roomStore';

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
    // 普通房间“进行中”但无 session(无 .json 持久化可恢复)时降级为“等待中”,
    // 让房主可在房间列表看到房间并重新开局;否则 getRoomList 的 hasSession 过滤
    // 会让它从列表中永久消失,房主无法管理。
    downgradeStaleNormalRooms();
    // 恢复后立即清理僵尸房间(无 seats 的进行中房间),避免它们出现在房间列表。
    cleanupIdleRooms();
  })();
}

/** 从 DB 恢复普通房间元数据。快闪房间不入库,无需恢复。
 *  普通房间(normal)的契约是「不自动销毁」:无论多旧都应恢复,仅在房主显式删除时移除。 */
async function restoreNormalRoomsFromDb(): Promise<void> {
  const rows = await loadAllRoomsFromDb();
  log.info(`启动恢复：发现 ${rows.length} 个普通房间记录`);
  for (const row of rows) {
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

/** 将无活跃 session 的普通房间降级为"等待中"。
 *  导出供单元测试调用。
 *  涵盖「进行中」和「已结束」两种状态:房间在游戏中进程被 kill,或游戏结束后
 *  玩家未点击「再来一局」即重启 → DB 记录状态仍是进行中/已结束,但 data/rooms 下
 *  无对应 .json(或 .json 已被过期清理)→ restorePersistedRooms 不会创建 GameSession。
 *  不降级的话 getRoomList 的 hasSession 过滤会让它从房间列表消失,房主无法看到房间。 */
export async function downgradeStaleNormalRooms(): Promise<void> {
  const { getAllRooms } = await import('./room');
  // 用 getAllRooms(不过滤)而非 getRoomList:getRoomList 会过滤"非等待中且无 session"的房间,
  // 但本函数正是要降级这些房间。用 getRoomList 会跳过它们,导致死锁。
  const normalRooms = getAllRooms().filter((r) => r.roomType === 'normal');
  for (const room of normalRooms) {
    const roomId = room.id;
    if (gameSessions.has(roomId)) continue;
    if (room.status === '等待中') continue;
    // 清理局内状态:准备记录、座次。状态变更通过 setRoomStatus 同步 DB。
    const oldStatus = room.status;
    room.readyPlayers = new Set();
    room.seats = room.seats.map(() => null);
    setRoomStatus(roomId, '等待中');
    log.info(`降级普通房间 ${roomId}（无活跃 session,${oldStatus}→等待中）`);
  }
}

async function restorePersistedRooms(): Promise<void> {
  const roomIds = await listPersistedRooms();
  log.info(`启动恢复：发现 ${roomIds.length} 个持久化房间`);
  // skill 注册表是 state-bound(WeakMap 外挂),每个房间的 state 自带独立注册表,
  // 无需启动时清理全局表。bootstrap 会为每个 state 注册各自的技能实例。
  // 清理超过 1 小时的游戏状态 .json(快速房间整体回收;普通房间仅删局内状态,
  // 房间元数据由 restoreNormalRoomsFromDb 从 DB 恢复,不受此影响)
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  for (const roomId of roomIds) {
    try {
      const persisted = await loadRoom(roomId);
      if (!persisted) {
        // 文件损坏/格式不兼容:删除避免每次启动重复尝试
        log.info(`房间 ${roomId} 持久化文件无法解析,删除`);
        await deletePersistedRoom(roomId);
        continue;
      }
      // 用 startedAt(游戏开始时间)判定过期,不用文件 mtime:
      // restoreState 后 pending slot 定时器会反复触发 saveRoom 刷新 mtime,
      // 导致 mtime 永远是最近的,过期检查失效。
      // 旧数据/未开局测试房间 startedAt 可能为 0(默认值),回退用 savedAt
      // 判过期——否则这类房间永不过期,每次启动都被恢复成僵尸 session。
      const startedAt = persisted.state?.startedAt ?? 0;
      const refTime = startedAt || persisted.savedAt;
      if (refTime && now - refTime > ONE_HOUR) {
        const when = new Date(refTime).toISOString();
        log.info(`跳过过期房间 ${roomId}（${startedAt ? '游戏开始' : '保存'}: ${when}）`);
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
      // 复用 existingRoom(normal 房间从 DB 恢复)时,DB schema 不存 seats,
      // existingRoom.seats 是恢复时初始化的全 null 数组。必须用 .json 的 seats 覆盖,
      // 否则 GameSession 构造时从 room.seats 填充 playerNames 会得到空映射,
      // 玩家无法重连(session 存在但认不出任何 playerId)。
      if (existingRoom) {
        existingRoom.seats = restoredSeats;
        if (persisted.hostId !== undefined) existingRoom.hostId = persisted.hostId;
      }
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
