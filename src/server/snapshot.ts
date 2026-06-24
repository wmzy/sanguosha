// src/server/snapshot.ts
// Debug 快照功能:把前后端完整游戏状态冻结保存到 data/snapshots/。
// 只读旁路——不调 dispatch、不改 state、不影响游戏流程。
// 设计依据:docs/superpowers/specs/2026-06-24-debug-snapshot-design.md

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameState, ActionLogEntry, AppliedAtomEntry, ViewEventSplit, Json, GameView } from '../engine/types';
import type { GameSession } from './session';
import { sanitizeState } from './persistence';
import { createLogger } from './logger';
import { ENGINE_VERSION } from './version';

const log = createLogger('snapshot');

const SNAPSHOT_DIR = join(process.cwd(), 'data', 'snapshots');

/** 快照文件中 pending slot 的纯数据形式(剥离函数和 definition) */
interface PendingSlotData {
  target: number;
  atom: Json;
  startTime: number;
  deadline: number;
  isBlocking: boolean;
  createdSeq: number;
  isTimeout: boolean;
}

/** 快照文件中的 backend 块 */
interface SnapshotBackend {
  state: GameState;
  actionLog: ActionLogEntry[];
  atomHistory: Array<{
    kind: 'atom' | 'notify';
    seq: number;
    timestamp: number;
    atom?: Json;
    skillId?: string;
    eventType?: string;
    data?: Json;
    viewEvents?: { ownerViews: Array<[number, Json | null]>; othersView: Json | null };
    views?: Array<[string, Json]>;
  }>;
  sessionSeed: number;
  lastActivityAt: number;
}

/** 快照文件根结构 */
export interface DebugSnapshot {
  meta: {
    snapshotId: string;
    roomId: string;
    roomName: string;
    createdAt: number;
    description: string | null;
    playerCount: number;
    debug: boolean;
    engineVersion: string;
  };
  alignment: {
    frontendSeqs: Record<string, number>;
    backendSeq: number;
    backendCapturedAt: number;
    note: string;
  };
  backend: SnapshotBackend;
  frontend: {
    perspective: number;
    views: Record<string, GameView>;
  };
}

/** 序列化 ViewEventSplit 的 Map 为数组对(可 JSON 序列化) */
function serializeViewEventSplit(split: ViewEventSplit): {
  ownerViews: Array<[number, Json | null]>;
  othersView: Json | null;
} {
  return {
    ownerViews: [...split.ownerViews.entries()].map(([k, v]) => [k, v as Json | null]),
    othersView: (split.othersView ?? null) as Json | null,
  };
}

/** 序列化 atomHistory:把 Map 结构转为数组对 */
function serializeAtomHistory(history: AppliedAtomEntry[]): SnapshotBackend['atomHistory'] {
  return history.map(entry => {
    if (entry.kind === 'atom') {
      return {
        kind: 'atom' as const,
        seq: entry.seq,
        timestamp: entry.timestamp,
        atom: entry.atom as unknown as Json,
        viewEvents: serializeViewEventSplit(entry.viewEvents),
      };
    }
    return {
      kind: 'notify' as const,
      seq: entry.seq,
      timestamp: entry.timestamp,
      skillId: entry.skillId,
      eventType: entry.eventType,
      data: entry.data,
      views: entry.views ? [...entry.views.entries()] : undefined,
    };
  });
}

/** 序列化 pendingSlots:保留纯数据,剥离 resolve/pause/definition 等函数引用 */
function serializePendingSlots(state: GameState): PendingSlotData[] {
  const slots: PendingSlotData[] = [];
  for (const [target, slot] of state.pendingSlots) {
    slots.push({
      target,
      atom: slot.atom as unknown as Json,
      startTime: slot.startTime,
      deadline: slot.deadline,
      isBlocking: slot.isBlocking,
      createdSeq: slot.createdSeq,
      isTimeout: slot.isTimeout,
    });
  }
  return slots;
}

/** 完整序列化 GameState 用于快照:复用 sanitizeState 剥离函数,
 *  但额外保留 pendingSlots 的纯数据(审查 bug 的关键信息)。 */
function serializeStateForSnapshot(state: GameState): GameState & { pendingSlotsData: PendingSlotData[] } {
  const sanitized = sanitizeState(state);
  return {
    ...sanitized,
    pendingSlotsData: serializePendingSlots(state),
  };
}

function timestampId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  // 追加 4 位随机后缀,避免同一秒内对同一 roomId 连续快照时文件名碰撞覆盖
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${suffix}`;
}

async function ensureSnapshotDir(): Promise<void> {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
}

function snapshotPath(snapshotId: string): string {
  return join(SNAPSHOT_DIR, `${snapshotId}.json`);
}

/** 创建快照请求体 */
export interface CreateSnapshotRequest {
  roomId: string;
  perspective: number;
  frontendSeqs: Record<string, number>;
  frontendViews: Record<string, GameView>;
}

/** 创建快照:同步只读采集 session 状态,写入 data/snapshots/。
 *  返回 snapshotId(= 文件名,不含 .json)。session 无状态返回错误。 */
export async function createSnapshot(
  session: GameSession,
  req: CreateSnapshotRequest,
): Promise<{ snapshotId: string } | { error: string; status: 400 | 403 | 404 | 500 }> {
  const state = session.getState();
  if (!state) return { error: '会话无状态', status: 404 };

  // 校验 debug 标志(通过 reflection:session 未暴露 isDebug getter)
  const isDebug = (session as unknown as { debug: boolean }).debug;
  if (!isDebug) return { error: '仅 debug 模式可用', status: 403 };

  const snapshotId = `${timestampId()}-${req.roomId}`;
  const backendCapturedAt = Date.now();

  // 取 sessionSeed(私有字段,reflection 读取)
  const sessionSeed = (session as unknown as { sessionSeed: number }).sessionSeed;

  const snapshot: DebugSnapshot = {
    meta: {
      snapshotId,
      roomId: req.roomId,
      roomName: (session as unknown as { room: { name: string } }).room.name,
      createdAt: backendCapturedAt,
      description: null,
      playerCount: state.players.length,
      debug: isDebug,
      engineVersion: ENGINE_VERSION,
    },
    alignment: {
      frontendSeqs: req.frontendSeqs,
      backendSeq: state.seq,
      backendCapturedAt,
      note: 'backendSeq - frontendSeq[i] = 未到达该座次的事件数',
    },
    backend: {
      state: serializeStateForSnapshot(state),
      actionLog: session.getGameLog() ?? [],
      atomHistory: serializeAtomHistory(state.atomHistory),
      sessionSeed,
      lastActivityAt: session.getLastActivityAt(),
    },
    frontend: {
      perspective: req.perspective,
      views: req.frontendViews,
    },
  };

  try {
    await ensureSnapshotDir();
    await writeFile(snapshotPath(snapshotId), JSON.stringify(snapshot, null, 2));
    log.info(`快照已保存: ${snapshotId}`);
    return { snapshotId };
  } catch (err) {
    log.error(`快照保存失败: ${String(err)}`);
    return { error: '快照保存失败', status: 500 };
  }
}

/** 追加描述到已有快照 */
export async function patchSnapshotDescription(
  snapshotId: string,
  description: string,
): Promise<{ success: true } | { error: string; status: 400 | 403 | 404 | 500 }> {
  const path = snapshotPath(snapshotId);
  try {
    const raw = await readFile(path, 'utf-8');
    const snapshot = JSON.parse(raw) as DebugSnapshot;
    snapshot.meta.description = description;
    await writeFile(path, JSON.stringify(snapshot, null, 2));
    log.info(`快照描述已更新: ${snapshotId}`);
    return { success: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { error: '快照不存在', status: 404 };
    log.error(`快照描述更新失败: ${String(err)}`);
    return { error: '快照描述更新失败', status: 500 };
  }
}
