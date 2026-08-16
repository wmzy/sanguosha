// src/server/gameHistory.ts — 房间对局历史存储层。
//
// 数据布局:每个房间一个目录 data/history/<roomId>/:
//   index.json        — 条目列表(结果元数据,不含录像,列表接口只读这个)
//   <entryId>.json    — 单局完整录像(客户端 v2 ReplayFile 格式,与本地录制/回放兼容)
//
// 设计:
// - 内存缓存 + 懒加载:首次访问读盘,之后走缓存;写入经 per-room 串行链,
//   避免并发 append 互相覆盖 index。
// - 每房间保留最新 MAX_ENTRIES_PER_ROOM 条(含录像文件),超出裁剪最旧并删其录像文件。
// - 房间销毁走 deleteRoomHistory 整目录删除(teardown.destroyRoomCompletely 统一调用);
//   启动时 sweepOrphanHistory 清理上次进程崩溃遗留的孤儿目录(快速房不恢复,历史无主)。
// - roomId 来自 URL 参数,统一过 SAFE_ROOM_ID 校验,防路径穿越。
//
// 录像组装(buildReplayFile)复用客户端 ReplayRecorder:逐座次喂入
// 「开局基线视图 + eventsForViewer 差量事件」,保证与本地录制文件格式完全一致,
// 前端 loadReplay/isReplayFile/useReplay 无需任何改动即可重放。

import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createLogger } from './logger';
import { register as registerLifecycle } from './lifecycles';
import { ReplayRecorder } from '../client/replay/recorder';
import { eventsForViewer } from '../engine/view/events-for-viewer';
import type { ReplayFile, ReplayMeta, SeatDelta } from '../client/replay/types';
import type { GameState, GameView } from '../engine/types';

const log = createLogger('gameHistory');

export const HISTORY_DIR = process.env.SGS_HISTORY_DIR
  ? resolve(process.env.SGS_HISTORY_DIR)
  : join(process.cwd(), 'data', 'history');

/** 每房间保留的历史条数上限(含录像文件),防止磁盘无限增长 */
export const MAX_ENTRIES_PER_ROOM = 20;

/** roomId 白名单:服务端生成的房间码为字母数字;拒绝路径穿越/特殊字符 */
const SAFE_ROOM_ID = /^[A-Za-z0-9_-]+$/;
const SAFE_ENTRY_ID = /^[A-Za-z0-9_-]+$/;

/** roomId → 条目列表(时间升序,最新在末尾)。懒加载缓存 */
const cache = new Map<string, GameHistoryEntry[]>();
/** roomId → 进行中的写链(串行化 append/delete/clear,防 index 并发覆盖) */
const inflight = new Map<string, Promise<unknown>>();

registerLifecycle('gameHistoryCache', cache, () => {
  cache.clear();
});

// ── 数据结构 ──

/** 单个玩家的对局结果(座次/身份/胜负) */
export interface GameHistoryPlayer {
  /** 游戏座次下标 */
  seat: number;
  /** 玩家连接身份(playerId);无映射时退回引擎名 */
  playerId: string;
  character: string;
  identity: string;
  alive: boolean;
  hp: number;
  /** 本局是否获胜;null=平局/中断(无胜负) */
  won: boolean | null;
}

/** 一局游戏的历史条目(列表接口返回;录像单独存取) */
export interface GameHistoryEntry {
  id: string;
  roomId: string;
  roomName: string;
  gameMode: string;
  /** 本局开始时刻(Date.now;恢复局取恢复时刻) */
  startedAt: number;
  endedAt: number;
  /** '正常'=胜负判定结束;'中断'=全员掉线宽限超时 */
  endedReason: '正常' | '中断';
  /** 胜方阵营文案:'主公方'|'反贼'|'内奸'|'平局'|'中断' */
  winnerLabel: string;
  players: GameHistoryPlayer[];
  /** 是否有可下载/重放的录像(开局基线缺失时为 false,如服务端重启前的残局) */
  hasReplay: boolean;
}

/** 身份 → 阵营(与前端 GameResultOverlay.identityCamp 语义一致) */
export function identityCamp(identity: string | undefined): '主公方' | '反贼' | '内奸' | null {
  if (identity === '主公' || identity === '忠臣') return '主公方';
  if (identity === '反贼') return '反贼';
  if (identity === '内奸') return '内奸';
  return null;
}

// ── 纯构造函数(供 session 调用 + 单测) ──

/** 从终局 state 构建历史条目(不含录像,hasReplay 由调用方按录像组装结果回填)。
 *  seatPlayerIds: 座次 → playerId(用于展示真实玩家身份,而非引擎生成的 P0/P1)。 */
export function buildHistoryEntry(
  state: GameState,
  seatPlayerIds: string[],
  opts: {
    roomId: string;
    roomName: string;
    gameMode: string;
    startedAt: number;
    endedAt: number;
    winner?: number;
    reason: '正常' | '中断';
  },
): GameHistoryEntry {
  const winnerCamp =
    opts.reason === '中断' || opts.winner === undefined
      ? null
      : identityCamp(state.players[opts.winner]?.identity);
  const winnerLabel =
    opts.reason === '中断' ? '中断' : winnerCamp ?? '平局';
  const players: GameHistoryPlayer[] = state.players.map((p) => ({
    seat: p.index,
    playerId: seatPlayerIds[p.index] ?? p.name,
    character: p.character ?? '',
    identity: p.identity ?? '',
    alive: p.alive,
    hp: p.health,
    won: winnerCamp === null ? null : identityCamp(p.identity) === winnerCamp,
  }));
  return {
    id: `${opts.endedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    roomId: opts.roomId,
    roomName: opts.roomName,
    gameMode: opts.gameMode,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    endedReason: opts.reason,
    winnerLabel,
    players,
    hasReplay: false,
  };
}

/** 从终局 state + 开局基线视图组装 v2 录像文件。
 *  baselineViews: 开局(选将完成后)逐座次捕获的完整视图;
 *  baselineSeq:  捕获时的 state.seq,此后的事件逐条追加(与客户端实时录制同构:
 *                initialView + 增量 ViewEvent,notify 事件不进录像)。
 *  基线缺失(空数组)返回 null。 */
export function buildReplayFile(
  state: GameState,
  baselineViews: GameView[],
  baselineSeq: number,
  meta: ReplayMeta,
): ReplayFile | null {
  if (baselineViews.length === 0) return null;
  const rec = new ReplayRecorder();
  for (const bv of baselineViews) {
    // 座次键取视图自身的 viewer(玩家座次 0..N-1;旁观基线为 -1),
    // 而非数组下标——session 会把旁观基线追加在数组末尾。
    // 首次 record 捕获该座次 initialView(空事件批次仅注册)
    rec.record(bv.viewer, bv, [], 0);
    for (const env of eventsForViewer(state, bv.viewer, baselineSeq)) {
      // notify 事件客户端不录制(viewMaintainer 只把 msg.view 推入 newEvents),保持一致
      if (!env.view) continue;
      // 逐条喂入保留每条事件的相对时间戳(批量 record 会共用同一 time)
      rec.record(bv.viewer, null, [env.view], env.timestamp);
    }
  }
  if (!rec.hasData()) return null;
  return rec.finalize(meta);
}

// ── 磁盘存取 ──

function isSafeId(id: string): boolean {
  return SAFE_ROOM_ID.test(id);
}

function roomDir(roomId: string): string {
  return join(HISTORY_DIR, roomId);
}

function indexPath(roomId: string): string {
  return join(roomDir(roomId), 'index.json');
}

function replayPath(roomId: string, entryId: string): string {
  return join(roomDir(roomId), `${entryId}.json`);
}

function isHistoryEntry(value: unknown): value is GameHistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o['id'] === 'string' &&
    typeof o['roomId'] === 'string' &&
    typeof o['endedAt'] === 'number' &&
    typeof o['winnerLabel'] === 'string' &&
    Array.isArray(o['players'])
  );
}

/** 读盘(绕过缓存)。目录不存在/损坏 → 空列表。 */
async function readIndexFromDisk(roomId: string): Promise<GameHistoryEntry[]> {
  try {
    const raw = await readFile(indexPath(roomId), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryEntry);
  } catch {
    return [];
  }
}

/** per-room 串行执行写操作:后到的写等待先前的写落盘,防 index 互相覆盖。 */
function serializeWrite<T>(roomId: string, run: () => Promise<T>): Promise<T> {
  const prev = inflight.get(roomId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(run);
  inflight.set(roomId, next);
  return next.finally(() => {
    if (inflight.get(roomId) === next) inflight.delete(roomId);
  });
}

/** 追加一局历史(通常在游戏结束时调用一次)。replay 为 null 时条目 hasReplay=false。
 *  超出上限时裁掉最旧条目并删除其录像文件。 */
export async function appendGameHistory(
  roomId: string,
  entry: GameHistoryEntry,
  replay: ReplayFile | null,
): Promise<void> {
  if (!isSafeId(roomId)) return;
  await serializeWrite(roomId, async () => {
    const entries = await readIndexFromDisk(roomId);
    entries.push(entry);
    const trimmed = entries.slice(-MAX_ENTRIES_PER_ROOM);
    const removed = entries.slice(0, entries.length - trimmed.length);
    await mkdir(roomDir(roomId), { recursive: true });
    if (replay) {
      await writeFile(replayPath(roomId, entry.id), JSON.stringify(replay));
    }
    await writeFile(indexPath(roomId), JSON.stringify(trimmed));
    for (const r of removed) {
      await rm(replayPath(roomId, r.id), { force: true });
    }
    cache.set(roomId, trimmed);
  });
}

/** 历史列表(时间降序,最新在前)。懒加载:首次读盘,之后走缓存。 */
export async function listGameHistory(roomId: string): Promise<GameHistoryEntry[]> {
  if (!isSafeId(roomId)) return [];
  const cached = cache.get(roomId);
  if (cached) return [...cached].reverse();
  const entries = await readIndexFromDisk(roomId);
  cache.set(roomId, entries);
  return [...entries].reverse();
}

/** 读取单局录像。文件缺失/格式不符 → null。 */
export async function getGameReplay(roomId: string, entryId: string): Promise<ReplayFile | null> {
  if (!isSafeId(roomId) || !SAFE_ENTRY_ID.test(entryId)) return null;
  try {
    const raw = await readFile(replayPath(roomId, entryId), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const o = parsed as { format?: unknown; version?: unknown };
    if (o?.format !== 'sanguosha-replay' || o?.version !== 2) return null;
    return parsed as ReplayFile;
  } catch {
    return null;
  }
}

/** 按请求者过滤录像可看的座次(重放视角限制):
 *  - 参赛玩家(seat 为其在终局条目中的座次)→ 只保留自己的座次 delta;
 *  - 其他人(旁观者/未参赛)→ 只保留旁观座次(-1,无私有手牌);
 *  - 旧录像没有旁观 delta 时,从最小玩家座次合成:剥离私有手牌、身份只保留
 *    明置主公(事件流沿用该座次的 othersView 投影,与旁观视角公开信息基本一致)。
 *  完整多座次录像仍可经 ?download=1 导出(导出是显式动作,不做视角裁剪)。 */
export function filterReplayForViewer(file: ReplayFile, seat: number | null): ReplayFile {
  if (seat !== null && seat >= 0 && file.seats[seat]) {
    return { ...file, seats: { [seat]: file.seats[seat] } };
  }
  const spectator = file.seats[-1];
  if (spectator) {
    return { ...file, seats: { [-1]: spectator } };
  }
  const playerSeats = Object.keys(file.seats)
    .map(Number)
    .filter((s) => s >= 0)
    .sort((a, b) => a - b);
  const src = playerSeats.length > 0 ? file.seats[playerSeats[0]] : null;
  if (!src) return { ...file, seats: {} };
  const fallback: SeatDelta = {
    ...src,
    viewer: -1,
    playerName: '旁观',
    privateHands: [],
    identityView: src.identityView.map((e) =>
      e.identityHidden === false
        ? e
        : { index: e.index, identity: undefined, identityHidden: true },
    ),
  };
  return { ...file, seats: { [-1]: fallback } };
}

/** 删除单条历史(含录像文件)。返回条目是否存在。 */
export async function deleteGameHistoryEntry(roomId: string, entryId: string): Promise<boolean> {
  if (!isSafeId(roomId) || !SAFE_ENTRY_ID.test(entryId)) return false;
  return serializeWrite(roomId, async () => {
    const entries = await readIndexFromDisk(roomId);
    const next = entries.filter((e) => e.id !== entryId);
    if (next.length === entries.length) return false;
    await writeFile(indexPath(roomId), JSON.stringify(next));
    await rm(replayPath(roomId, entryId), { force: true });
    cache.set(roomId, next);
    return true;
  });
}

/** 清空房间全部历史(房主「清空」按钮)。 */
export async function clearGameHistory(roomId: string): Promise<void> {
  if (!isSafeId(roomId)) return;
  await serializeWrite(roomId, async () => {
    await rm(roomDir(roomId), { recursive: true, force: true });
    cache.delete(roomId);
  });
}

/** 整目录删除(房间销毁时调用,幂等)。 */
export async function deleteRoomHistory(roomId: string): Promise<void> {
  await clearGameHistory(roomId);
}

/** 启动清理:删除没有任何存活房间对应的孤儿历史目录。
 *  场景:进程崩溃时快速房的历史已落盘,但重启后快速房不恢复 → 历史无主。
 *  在房间恢复完成后调用,validRoomIds = 当前 roomList 全量 id。 */
export async function sweepOrphanHistory(validRoomIds: string[]): Promise<void> {
  const valid = new Set(validRoomIds.filter(isSafeId));
  let dirents: string[];
  try {
    dirents = await readdir(HISTORY_DIR);
  } catch {
    return; // 目录不存在(从未有过历史)
  }
  for (const name of dirents) {
    if (!valid.has(name)) {
      log.info(`清理孤儿历史目录 ${name}`);
      await rm(join(HISTORY_DIR, name), { recursive: true, force: true }).catch(() => {});
    }
  }
  // 同步内存缓存:只保留存活房间
  for (const roomId of [...cache.keys()]) {
    if (!valid.has(roomId)) cache.delete(roomId);
  }
}
