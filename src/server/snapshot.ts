// src/server/snapshot.ts
// Debug 快照功能:把前后端完整游戏状态冻结保存到 data/snapshots/。
// 只读旁路——不调 dispatch、不改 state、不影响游戏流程。
// 设计依据:docs/superpowers/specs/2026-06-24-debug-snapshot-design.md

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  GameState,
  ActionLogEntry,
  AppliedAtomEntry,
  ViewEventSplit,
  Json,
  GameView,
} from '../engine/types';
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

/** 前端遥测原始数据(由 collectTelemetry 采集,随 POST 发来) */
export interface TelemetryPayload {
  consoleLog: Json[];
  wsMessages: Json[];
  userActions: Json[];
  domHtml: string;
  capturedAt: number;
  viewport: { width: number; height: number };
  url: string;
}

/** 快照中的遥测元数据(sidecar 文件引用,不内联大数据) */
interface SnapshotTelemetryMeta {
  console: { filename: string; entryCount: number };
  wsMessages: { filename: string; entryCount: number };
  dom: { filename: string; sizeBytes: number };
  userActions: { entryCount: number };
  capturedAt: number;
  viewport: { width: number; height: number };
  url: string;
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
  /** 遥测 sidecar 元数据(仅当前端安装了 telemetry 时存在) */
  telemetry?: SnapshotTelemetryMeta;
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
  return history.map((entry) => {
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
function serializeStateForSnapshot(
  state: GameState,
): GameState & { pendingSlotsData: PendingSlotData[] } {
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

async function ensureSnapshotDir(snapshotId: string): Promise<void> {
  // 每个快照独占一个目录:data/snapshots/<snapshotId>/
  await mkdir(join(SNAPSHOT_DIR, snapshotId), { recursive: true });
}

function snapshotPath(snapshotId: string, filename?: string): string {
  // 每个快照是一个目录。主文件: snapshot.json, sidecars: console.txt / ws.jsonl / dom.html
  return join(SNAPSHOT_DIR, snapshotId, filename ?? 'snapshot.json');
}

/** 创建快照请求体 */
export interface CreateSnapshotRequest {
  roomId: string;
  perspective: number;
  frontendSeqs: Record<string, number>;
  frontendViews: Record<string, GameView>;
  /** 前端遥测数据(可选;前端安装 debugTelemetry 时提供) */
  telemetry?: TelemetryPayload;
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

  try {
    await ensureSnapshotDir(snapshotId);

    // 前端遥测写入独立 sidecar 文件(避免主快照 .json 膨胀)
    let telemetryMeta: SnapshotTelemetryMeta | undefined;
    if (req.telemetry) {
      const t = req.telemetry;

      const consoleText = t.consoleLog
        .map((e) => {
          const entry = e as { time: number; level: string; message: string };
          return `[${new Date(entry.time).toISOString()}] [${entry.level}] ${entry.message}`;
        })
        .join('\n');
      const wsLines = t.wsMessages.map((e) => JSON.stringify(e)).join('\n');
      const domHtml = t.domHtml;

      await Promise.all([
        writeFile(snapshotPath(snapshotId, 'console.txt'), consoleText),
        writeFile(snapshotPath(snapshotId, 'ws.jsonl'), wsLines),
        writeFile(snapshotPath(snapshotId, 'dom.html'), domHtml),
      ]);

      telemetryMeta = {
        console: { filename: 'console.txt', entryCount: t.consoleLog.length },
        wsMessages: { filename: 'ws.jsonl', entryCount: t.wsMessages.length },
        dom: { filename: 'dom.html', sizeBytes: Buffer.byteLength(domHtml, 'utf-8') },
        userActions: { entryCount: t.userActions.length },
        capturedAt: t.capturedAt,
        viewport: t.viewport,
        url: t.url,
      };
    }

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
      telemetry: telemetryMeta,
    };

    await writeFile(snapshotPath(snapshotId), JSON.stringify(snapshot, null, 2));
    log.info(`快照已保存: ${snapshotId}`);
    return { snapshotId };
  } catch (err) {
    log.error(`快照保存失败: ${String(err)}`);
    return { error: '快照保存失败', status: 500 };
  }
}

/** snapshotId 合法字符白名单:服务端生成的格式为 `<时间戳>-<4位随机>-<房间ID>`,
 *  只含字母/数字/连字符。任何路径分隔符(/\)或 .. 都应被拒绝,防止路径遍历。 */
const SAFE_SNAPSHOT_ID = /^[A-Za-z0-9-]+$/;

/** 追加描述到已有快照 */
export async function patchSnapshotDescription(
  snapshotId: string,
  description: string,
): Promise<{ success: true } | { error: string; status: 400 | 403 | 404 | 500 }> {
  // snapshotId 来自 URL 参数(:id),客户端可控。必须校验,否则 ../ 可逃逸快照目录。
  if (!SAFE_SNAPSHOT_ID.test(snapshotId)) {
    return { error: '非法快照 ID', status: 400 };
  }
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
