// src/ai-mcp/feedbackHandler.ts
// reportBug 工具核心逻辑:把 agent 的 bug 描述 + 结构化字段 + 只读游戏快照写入本地 JSON。
// 不通过 WS 上报服务端,不影响 play 阻塞循环(只读访问 hgc,不调 drainNewEvents)。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectView } from './viewProjector';
import type { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import type { AiViewSnapshot, AvailableAction } from '../client/headless/types';

export type FeedbackSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FeedbackCategory =
  | 'skill-settlement'
  | 'state-inconsistency'
  | 'ui'
  | 'rule-violation'
  | 'other';

export interface ReportBugInput {
  description: string;
  severity?: FeedbackSeverity;
  category?: FeedbackCategory;
  expected?: string;
  actual?: string;
}

export interface ReportBugResult {
  ok: true;
  id: string;
  path: string;
  timestamp: string;
}

const DEFAULT_FEEDBACK_DIR = 'data/ai-feedback';
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 6 位 base62 随机串,防同秒碰撞。 */
function generateId(): string {
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return id;
}

/** YYYYMMDDTHHMMSS 本地时间格式,与 data/snapshots/ 命名风格一致。 */
function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** 落盘目录:优先 SGS_FEEDBACK_DIR,否则默认 data/ai-feedback。 */
export function resolveFeedbackDir(): string {
  return process.env.SGS_FEEDBACK_DIR ?? DEFAULT_FEEDBACK_DIR;
}

/**
 * 把 agent 的 bug 反馈 + 自动快照写入本地 JSON 文件。
 * 只读访问 hgc(view/getAvailableActions),不调 drainNewEvents,对 play 循环零副作用。
 */
export async function reportBugResult(
  input: ReportBugInput,
  hgc: HeadlessGameClient,
): Promise<ReportBugResult> {
  if (typeof input.description !== 'string' || !input.description.trim()) {
    throw new Error('description is required');
  }
  const dir = resolveFeedbackDir();
  await fs.mkdir(dir, { recursive: true });

  const now = new Date();
  const id = generateId();
  const filename = `${formatTimestamp(now)}-${id}.json`;
  const filePath = path.join(dir, filename);
  const timestamp = now.toISOString();

  // 只读快照:projectView 是纯函数,getAvailableActions 是只读枚举。
  // 明确不调用 drainNewEvents(消费式,会偷走下一次 play 的 recentEvents)。
  const view: AiViewSnapshot | null = hgc.view ? projectView(hgc.view) : null;
  const availableActions: AvailableAction[] = hgc.getAvailableActions();

  const payload = {
    id,
    timestamp,
    reporter: {
      roomId: hgc.roomId,
      seat: hgc.seatIndex,
      phase: hgc.phase,
    },
    severity: input.severity ?? 'medium',
    category: input.category ?? 'other',
    description: input.description,
    expected: input.expected ?? null,
    actual: input.actual ?? null,
    snapshot: {
      view,
      availableActions,
    },
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  return { ok: true, id, path: path.resolve(filePath), timestamp };
}
