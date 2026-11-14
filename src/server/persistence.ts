// src/server/persistence.ts
import { writeFile, readFile, unlink, rename, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActionLogEntry, GameState } from '../engine/types';
import { RealClock } from '../engine/core/clock';
import { register as registerLifecycle } from './resourceRegistry';
import { createRoomSerialChain } from './serialChain';
import { isSafeRoomId } from './safeId';
import { createLogger, normalizeError } from './logger';
// 函数级循环依赖(persistence→eventJournal→snapshot→persistence):所有交叉引用均在
// 函数体内调用,模块求值期无访问,ESM 下安全。详见 eventJournal.ts 头部注释。
import { removeEventJournal } from './eventJournal';

const DATA_DIR = join(process.cwd(), 'data', 'rooms');

const log = createLogger('persistence');

const DEBOUNCE_MS = 1000;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingWrappers = new Map<string, PersistedWrapper>();

/** 每房间所有快照写入、flush 与删除共享一条串行链(错误抛给调用方)。 */
const { chains: roomChains, enqueue: enqueueRoom } = createRoomSerialChain('roomChains');
/** 墓碑:正在删除的 roomId。阻止 debounce 回调和 saveRoom 在删除后重新写盘。 */
const deletedRoomIds = new Set<string>();

registerLifecycle('roomChains', roomChains, () => {
  roomChains.clear();
});
registerLifecycle('pendingTimers', pendingTimers, () => {
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
});

registerLifecycle('pendingWrappers', pendingWrappers, () => {
  pendingWrappers.clear();
});

export interface PlayerConfig {
  name: string;
  characterId: string;
  role: string;
}

interface PersistedWrapper {
  roomName: string;
  maxPlayers: number;
  hostId: string | null;
  debug: boolean;
  /** 座次→playerId 映射,用于重启后恢复玩家重连。旧数据无此字段时为 undefined。 */
  seats?: (string | null)[];
  players: PlayerConfig[];
  seed: number;
  actionLog: ActionLogEntry[];
  state: GameState;
  savedAt: number;
}

async function ensureDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

function filePath(roomId: string): string {
  // 与 eventJournal/gameHistory 同一白名单(单一来源 safeId):拒绝路径穿越/特殊字符。
  // 非法 roomId 直接抛错 → 落盘/删除被拒,不允许越界文件名触盘。
  if (!isSafeRoomId(roomId)) {
    throw new Error(`拒绝为非法 roomId 生成持久化路径: ${roomId}`);
  }
  return join(DATA_DIR, `${roomId}.json`);
}

async function writeNow(roomId: string, wrapper: PersistedWrapper): Promise<void> {
  const path = filePath(roomId);
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(wrapper));
    await rename(tempPath, path);
  } catch (err) {
    try {
      await unlink(tempPath);
    } catch {
      // 临时文件清理失败不覆盖原始写入错误
    }
    log.err(`save failed for room ${roomId}`, err);
    throw normalizeError(err);
  }
}

async function readWrapperFromDisk(roomId: string): Promise<PersistedWrapper | null> {
  const path = filePath(roomId);
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedWrapper(parsed)) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    log.err(`read failed for room ${roomId}`, err);
    throw normalizeError(err);
  }
}

async function deleteFile(roomId: string): Promise<void> {
  const path = filePath(roomId);
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    log.err(`delete failed for room ${roomId}`, err);
    throw normalizeError(err);
  }
}

function isPersistedWrapper(value: unknown): value is PersistedWrapper {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['roomName'] !== 'string') return false;
  if (typeof v['maxPlayers'] !== 'number') return false;
  // hostId 是后加字段,旧数据可能缺失(undefined)→视为 null
  if (v['hostId'] !== undefined && v['hostId'] !== null && typeof v['hostId'] !== 'string') return false;
  if (typeof v['debug'] !== 'boolean') return false;
  if (!Array.isArray(v['players'])) return false;
  if (typeof v['seed'] !== 'number') return false;
  if (!Array.isArray(v['actionLog'])) return false;
  if (typeof v['state'] !== 'object' || v['state'] === null) return false;
  if (typeof v['savedAt'] !== 'number') return false;
  return true;
}

export interface PersistedRoom {
  roomId: string;
  roomName: string;
  maxPlayers: number;
  hostId: string | null;
  debug: boolean;
  /** 座次→playerId 映射,用于重启后恢复玩家重连。旧数据无此字段时为 undefined。 */
  seats?: (string | null)[];
  players: PlayerConfig[];
  seed: number;
  actionLog: ActionLogEntry[];
  state: GameState;
  savedAt: number;
  lastActivityAt: number;
}

/** 清理 GameState 中的循环引用(函数、定时器等,不可 JSON 序列化) */
export function sanitizeState(state: GameState): GameState {
  return {
    ...state,
    // pendingSlots 含 resolve/pause/定时器等函数引用,持久化时清空。
    // restore 路径走 bootstrap 重放 actionLog,会重建 pending。
    pendingSlots: new Map(),
    // atomHistory 不持久化:恢复路径(restoreFromLog → restoreState → create+bootstrap+restore)
    // 从不读取快照里的 atomHistory,重放后由 fresh state 重建——持久化它是死重
    // (每局数百条含 viewEvents 分叉,体积可观)。完整事件流由服务端 eventJournal
    // 落盘(data/rooms/<roomId>.events.jsonl),内存只保留活跃窗口(session 裁剪)。
    atomHistory: [],
    atomStack: [],
    // clock 是执行环境(含 setTimeout/虚拟事件队列),非游戏状态,不持久化。
    // 恢复时由 create(config) 重新注入 RealClock。
    clock: new RealClock(),
    settlementStack: state.settlementStack.map((f) => {
      // SettlementFrame 运行时挂有 _executor 函数引用(不可序列化),持久化时剩离。
      // 经 unknown 中转:SettlementFrame 与 Record 结构重叠不足,TS 要求显式两步转换。
      const { _executor, ...rest } = f as unknown as Record<string, unknown>;
      return rest as unknown as typeof f;
    }),
  };
}

export async function saveRoom(
  roomId: string,
  meta: {
    roomName: string;
    maxPlayers: number;
    hostId: string | null;
    debug: boolean;
    /** 座次→playerId 映射,用于重启后恢复玩家重连 */
    seats?: (string | null)[];
  },
  state: GameState,
  actionLog: ActionLogEntry[],
  immediate = false,
): Promise<void> {
  // 墓碑检查必须在构造快照前完成;目录创建也放入串行操作,避免删除期间 mkdir/写盘。
  if (deletedRoomIds.has(roomId)) return;
  const wrapper: PersistedWrapper = {
    roomName: meta.roomName,
    maxPlayers: meta.maxPlayers,
    hostId: meta.hostId,
    debug: meta.debug,
    seats: meta.seats,
    players: state.players.map((p) => ({
      name: p.name,
      characterId: p.character,
      role: '主公',
    })),
    seed: state.rngSeed,
    actionLog: [...actionLog],
    state: sanitizeState(state),
    savedAt: Date.now(),
  };

  if (immediate) {
    const existing = pendingTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      pendingTimers.delete(roomId);
    }
    pendingWrappers.delete(roomId);
    return enqueueRoom(roomId, async () => {
      await ensureDir();
      await writeNow(roomId, wrapper);
    });
  }

  // 只保留最新 debounce 快照。timer 身份检查可防止已清除的旧回调回写。
  pendingWrappers.set(roomId, wrapper);
  const existing = pendingTimers.get(roomId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    if (pendingTimers.get(roomId) !== timer) return;
    pendingTimers.delete(roomId);
    const current = pendingWrappers.get(roomId);
    if (!current || current !== wrapper) return;
    pendingWrappers.delete(roomId);
    if (deletedRoomIds.has(roomId)) return;
    void enqueueRoom(roomId, async () => {
      if (deletedRoomIds.has(roomId)) return;
      await ensureDir();
      await writeNow(roomId, wrapper);
    }).catch(() => {
      // writeNow 已记录错误;定时写失败不得产生未处理 rejection,也不得毒化后续队列。
    });
  }, DEBOUNCE_MS);
  pendingTimers.set(roomId, timer);
}

export async function loadRoom(roomId: string): Promise<PersistedRoom | null> {
  const path = filePath(roomId);
  const wrapper = await readWrapperFromDisk(roomId);
  if (!wrapper) return null;
  let lastActivityAt: number;
  try {
    lastActivityAt = (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
  return {
    roomId,
    roomName: wrapper.roomName,
    maxPlayers: wrapper.maxPlayers,
    hostId: wrapper.hostId ?? null,
    debug: wrapper.debug,
    seats: wrapper.seats,
    players: wrapper.players,
    seed: wrapper.seed,
    actionLog: wrapper.actionLog,
    state: wrapper.state,
    savedAt: wrapper.savedAt,
    lastActivityAt,
  };
}

export async function deletePersistedRoom(roomId: string): Promise<void> {
  // 墓碑覆盖整个删除队列生命周期;队列完成后才允许同 roomId 新局保存。
  if (deletedRoomIds.has(roomId)) {
    const existing = roomChains.get(roomId);
    if (existing) await existing;
    return;
  }
  deletedRoomIds.add(roomId);
  const pending = pendingTimers.get(roomId);
  if (pending) {
    clearTimeout(pending);
    pendingTimers.delete(roomId);
  }
  pendingWrappers.delete(roomId);
  const deletion = enqueueRoom(roomId, async () => {
    await deleteFile(roomId);
    await removeEventJournal(roomId);
  });
  try {
    await deletion;
  } finally {
    // 即使 unlink/journal 删除失败,也不能永久阻断该 roomId 后续生命周期。
    deletedRoomIds.delete(roomId);
  }
}

export async function listPersistedRooms(): Promise<string[]> {
  await ensureDir();
  const entries = await readdir(DATA_DIR);
  return entries.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

export async function flushPendingWrites(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  for (const [roomId, wrapper] of pendingWrappers) {
    const timer = pendingTimers.get(roomId);
    if (timer) clearTimeout(timer);
    pendingTimers.delete(roomId);
    pendingWrappers.delete(roomId);
    if (deletedRoomIds.has(roomId)) continue;
    pending.push(
      enqueueRoom(roomId, async () => {
        if (deletedRoomIds.has(roomId)) return;
        await ensureDir();
        await writeNow(roomId, wrapper);
      }),
    );
  }
  // 快照本身可能在 flush 扫描后才进入房间链;等待当前链尾即可确保本次 flush 的所有排队 IO 完成。
  for (const chain of roomChains.values()) pending.push(chain);
  const results = await Promise.allSettled(pending);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

export function _pendingWriteCount(): number {
  return pendingTimers.size;
}

/** 从持久化日志恢复 state:返回最新一份 state 快照(可序列化部分)。
 * 持久化文件里 actionLog 与 state 都被保存 —— state 是 actionLog replay 出来的最终结果。
 * 这里只返回 JSON 快照(含 rngSeed/players/actionLog 等),供 session.restoreState 读取
 * seed/config。运行时内存状态(skill 实例/hooks/respond actions/pending slot 函数)无法
 * 从快照恢复,必须由 session.restoreState 走 create + bootstrap + restore 重建
 * (见 ADR 0027 决策 7 修订)。 */
export function restoreFromLog(persisted: PersistedRoom): GameState {
  const state = persisted.state;
  // JSON 反序列化后 pendingSlots 可能是普通对象,转回 Map
  if (!(state.pendingSlots instanceof Map)) {
    const entries = state.pendingSlots as unknown as
      | Array<[number, unknown]>
      | Record<string, unknown>;
    const map = new Map<number, unknown>();
    if (Array.isArray(entries)) {
      for (const [k, v] of entries) map.set(Number(k), v);
    } else if (entries && typeof entries === 'object') {
      for (const [k, v] of Object.entries(entries)) map.set(Number(k), v);
    }
    state.pendingSlots = map as GameState['pendingSlots'];
  }
  return state;
}
