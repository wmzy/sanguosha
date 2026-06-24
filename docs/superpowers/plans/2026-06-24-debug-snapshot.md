# Debug 模式快照功能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 debug 模式增加"保存快照"按钮,点击后把前后端完整游戏状态冻结保存到 `data/snapshots/`,供 AI 审查 bug。

**Architecture:** 前端按钮 → POST /api/snapshot(携带各座次 view/seq)→ 后端同步只读采集 session 状态 → 写 JSON 文件 → 返回 snapshotId → 前端弹框填描述 → PATCH /api/snapshot/:id 追加描述。引擎和 session 零改动,只读旁路。

**Tech Stack:** Hono(后端 REST)、React hooks(前端)、Node fs/promises(文件写入)、vitest(测试)

**设计依据:** `docs/superpowers/specs/2026-06-24-debug-snapshot-design.md`

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/server/snapshot.ts` | 快照创建 + 描述追加的处理函数,含序列化逻辑 | 新建 |
| `src/server/app.ts` | 注册 POST /api/snapshot + PATCH /api/snapshot/:id 路由 | 修改 |
| `src/server/persistence.ts` | 导出 `sanitizeState` 供复用 | 修改 |
| `src/client/hooks/useSnapshot.ts` | 前端 POST 创建 + PATCH 描述 + loading/error 状态 | 新建 |
| `src/client/components/DebugPerspectiveBar.tsx` | 加"保存快照"按钮 | 修改 |
| `src/client/components/DebugLobby.tsx` | DebugGameViewInner 接入 useSnapshot | 修改 |
| `tests/server/snapshot.test.ts` | 后端接口测试 | 新建 |

---

## 序列化关键决策(实现前必读)

直接 `JSON.stringify(GameState)` 会丢失以下内容,快照必须特殊处理:

1. **`pendingSlots: Map<number, PendingSlot>`**:PendingSlot 含 `resolve`/`pause`/`_fireTimeoutNow` 函数 + `definition`(AtomDefinition,含 validate/apply 函数)。`sanitizeState` 直接清空它 → 丢失"当前在等谁做什么"。
   - **快照方案**:把每个 slot 序列化为纯数据 `{ atom, startTime, deadline, isBlocking, createdSeq, isTimeout }`,剥离函数和 definition。

2. **`atomHistory: AppliedAtomEntry[]`**:含 `viewEvents: ViewEventSplit`(其 `ownerViews`/`othersView` 是 `ReadonlyMap`)和 `views: ReadonlyMap`。Map 不能 JSON.stringify(会变成 `{}`)。
   - **快照方案**:把 ViewEventSplit 的 Map 序列化为 `[[key, value], ...]` 数组形式,或 `Record<string, value>` 对象形式。

3. **`onStateChange` 回调**:`sanitizeState` 已处理(展开后会被 JSON.stringify 忽略函数,但显式剥离更干净)。
   - **快照方案**:复用 `sanitizeState` 的展开 + 额外处理 pendingSlots。

因此快照不用 `sanitizeState` 清空 pendingSlots,而是自定义 `serializeStateForSnapshot` 函数。

---

## Task 1: 后端 — 导出 sanitizeState

**Files:**
- Modify: `src/server/persistence.ts:114`

- [ ] **Step 1: 改 sanitizeState 为 export**

在 `src/server/persistence.ts` 第 115 行,把:

```ts
function sanitizeState(state: GameState): GameState {
```

改为:

```ts
export function sanitizeState(state: GameState): GameState {
```

- [ ] **Step 2: 验证 typecheck**

Run: `npx tsc --noEmit`
Expected: 无新增错误(已有错误是 baseline)

- [ ] **Step 3: Commit**

```bash
git add src/server/persistence.ts
git commit -m "refactor: 导出 sanitizeState 供快照功能复用"
```

---

## Task 2: 后端 — 新建 snapshot.ts 序列化与创建函数

**Files:**
- Create: `src/server/snapshot.ts`

- [ ] **Step 1: 编写 snapshot.ts(序列化 + 创建函数)**

创建 `src/server/snapshot.ts`:

```ts
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
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
 *  返回 snapshotId(= 文件名,不含 .json)。session 不存在返回 null。 */
export async function createSnapshot(
  session: GameSession,
  req: CreateSnapshotRequest,
): Promise<{ snapshotId: string } | { error: string; status: number }> {
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
      engineVersion: __APP_VERSION__,
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
): Promise<{ success: true } | { error: string; status: number }> {
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
```

- [ ] **Step 2: 定义 __APP_VERSION__ 全局常量**

在 `vite.config.ts` 的 `define` 中添加(让前后端都能用):

先读取当前 vite.config.ts:

```bash
cat vite.config.ts
```

在 `define` 字段里加:

```ts
define: {
  __APP_VERSION__: JSON.stringify(require('./package.json').version),
}
```

如果项目用 ESM(`"type": "module"`),改为读取方式:在 `vite.config.ts` 顶部:

```ts
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
```

define 里:

```ts
__APP_VERSION__: JSON.stringify(pkg.version),
```

同时需要在 `src/` 下新增全局类型声明文件 `src/global.d.ts`:

```ts
declare const __APP_VERSION__: string;
```

- [ ] **Step 3: 验证 typecheck**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add src/server/snapshot.ts src/global.d.ts vite.config.ts
git commit -m "feat: 新建 snapshot.ts 实现快照序列化与创建"
```

---

## Task 3: 后端 — app.ts 注册路由

**Files:**
- Modify: `src/server/app.ts`

- [ ] **Step 1: 在 app.ts 注册两个路由**

在 `src/server/app.ts` 顶部 import 区添加(找现有 import,加在 `persistence` 相关 import 附近):

```ts
import { createSnapshot, patchSnapshotDescription } from './snapshot';
```

在 `app.post('/api/debug-room', ...)` 之后(REST API 区块末尾、`handleWsMessage` 之前)添加:

```ts
// Debug 快照:保存前后端完整游戏状态到 data/snapshots/
app.post('/api/snapshot', async (c) => {
  const body = await c.req.json();
  if (!body || typeof body.roomId !== 'string') {
    return c.json({ error: '缺少 roomId' }, 400);
  }
  const session = gameSessions.get(body.roomId);
  if (!session) return c.json({ error: '会话不存在' }, 404);
  const result = await createSnapshot(session, body);
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

app.patch('/api/snapshot/:id', async (c) => {
  const snapshotId = c.req.param('id');
  const body = await c.req.json();
  if (!body || typeof body.description !== 'string') {
    return c.json({ error: '缺少 description' }, 400);
  }
  const result = await patchSnapshotDescription(snapshotId, body.description);
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});
```

- [ ] **Step 2: 验证 typecheck**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/server/app.ts
git commit -m "feat: 注册 POST/PATCH /api/snapshot 路由"
```

---

## Task 4: 后端测试 — snapshot.test.ts

**Files:**
- Create: `tests/server/snapshot.test.ts`

- [ ] **Step 1: 编写测试**

创建 `tests/server/snapshot.test.ts`:

```ts
// tests/server/snapshot.test.ts
// 验证 debug 快照功能:
// 1. 创建快照:session 存在 → 文件落盘 + 结构完整
// 2. 创建快照:session 不存在 → 404(在 app 层测,这里测 createSnapshot 返回)
// 3. 创建快照:非 debug session → 403
// 4. 创建快照后 state 引用/seq 不变(只读验证)
// 5. 追加描述:PATCH 后 description 更新
// 6. 追加描述:不存在的 snapshotId → 404
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetForTest } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import { createSnapshot, patchSnapshotDescription } from '../../src/server/snapshot';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';

const SNAPSHOT_DIR = join(process.cwd(), 'data', 'snapshots');

function makeRoom(isDebug = true): Room {
  return {
    id: 'snap-test-' + Math.random().toString(36).slice(2, 8),
    name: '快照测试房',
    maxPlayers: 4,
    players: new Map(),
    isDebug,
    createdAt: Date.now(),
    status: '进行中',
  } as unknown as Room;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}

async function readSnapshot(snapshotId: string): Promise<unknown> {
  const raw = await readFile(join(SNAPSHOT_DIR, `${snapshotId}.json`), 'utf-8');
  return JSON.parse(raw);
}

describe('debug 快照功能', () => {
  beforeEach(() => {
    resetForTest();
  });

  afterEach(async () => {
    // 清理测试快照文件
    try {
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(SNAPSHOT_DIR).catch(() => []);
      for (const f of files) {
        if (f.startsWith('snap-test-') || f.includes('snap-test-')) {
          await rm(join(SNAPSHOT_DIR, f));
        }
      }
    } catch {
      // 忽略清理失败
    }
  });

  it('创建快照:debug session 存在 → 返回 snapshotId + 文件落盘 + 结构完整', async () => {
    const room = makeRoom(true);
    const session = new GameSession(room, true, 42);
    await session.startGame(4);
    const state = getState(session);
    // 等 state 就绪
    for (let i = 0; i < 50 && !state.players.length; i++) await sleep(10);

    const result = await createSnapshot(session, {
      roomId: room.id,
      perspective: 0,
      frontendSeqs: { '0': 5, '1': 5, '2': 4, '3': 5 },
      frontendViews: { '0': { viewer: 0 } as never, '1': { viewer: 1 } as never },
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('snapshotId');
    const snapshotId = (result as { snapshotId: string }).snapshotId;
    expect(snapshotId).toContain(room.id);

    // 文件落盘
    const snapshot = (await readSnapshot(snapshotId)) as Record<string, unknown>;
    expect(snapshot).toHaveProperty('meta');
    expect(snapshot).toHaveProperty('alignment');
    expect(snapshot).toHaveProperty('backend');
    expect(snapshot).toHaveProperty('frontend');

    const meta = snapshot.meta as Record<string, unknown>;
    expect(meta.roomId).toBe(room.id);
    expect(meta.description).toBeNull();
    expect(meta.debug).toBe(true);

    const backend = snapshot.backend as Record<string, unknown>;
    expect(backend).toHaveProperty('state');
    expect(backend).toHaveProperty('actionLog');
    expect(backend).toHaveProperty('atomHistory');
  }, 15000);

  it('创建快照:非 debug session → 返回 403', async () => {
    const room = makeRoom(false);
    const session = new GameSession(room, false, 42);

    const result = await createSnapshot(session, {
      roomId: room.id,
      perspective: 0,
      frontendSeqs: {},
      frontendViews: {},
    });

    expect(result).toHaveProperty('error');
    expect((result as { status: number }).status).toBe(403);
  });

  it('创建快照:只读——不改变 state 引用和 seq', async () => {
    const room = makeRoom(true);
    const session = new GameSession(room, true, 42);
    await session.startGame(4);
    const state = getState(session);
    for (let i = 0; i < 50 && !state.players.length; i++) await sleep(10);

    const seqBefore = state.seq;
    const playersRefBefore = state.players;

    await createSnapshot(session, {
      roomId: room.id,
      perspective: 0,
      frontendSeqs: {},
      frontendViews: {},
    });

    expect(state.seq).toBe(seqBefore);
    expect(state.players).toBe(playersRefBefore);
  }, 15000);

  it('追加描述:PATCH 后 meta.description 更新', async () => {
    const room = makeRoom(true);
    const session = new GameSession(room, true, 42);
    await session.startGame(4);
    const state = getState(session);
    for (let i = 0; i < 50 && !state.players.length; i++) await sleep(10);

    const result = await createSnapshot(session, {
      roomId: room.id,
      perspective: 0,
      frontendSeqs: {},
      frontendViews: {},
    });
    const snapshotId = (result as { snapshotId: string }).snapshotId;

    const patchResult = await patchSnapshotDescription(snapshotId, 'P2 出杀后 P0 闪没弹窗');
    expect(patchResult).toEqual({ success: true });

    const snapshot = (await readSnapshot(snapshotId)) as { meta: { description: string } };
    expect(snapshot.meta.description).toBe('P2 出杀后 P0 闪没弹窗');
  }, 15000);

  it('追加描述:不存在的 snapshotId → 返回 404', async () => {
    const result = await patchSnapshotDescription('nonexistent-snapshot-id', '测试');
    expect(result).toHaveProperty('error');
    expect((result as { status: number }).status).toBe(404);
  });
});
```

- [ ] **Step 2: 运行测试验证**

Run: `npx vitest run tests/server/snapshot.test.ts`
Expected: 5 个测试全部 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/server/snapshot.test.ts
git commit -m "test: 添加 debug 快照功能后端测试"
```

---

## Task 5: 前端 — useSnapshot hook

**Files:**
- Create: `src/client/hooks/useSnapshot.ts`

- [ ] **Step 1: 编写 useSnapshot.ts**

创建 `src/client/hooks/useSnapshot.ts`:

```ts
// src/client/hooks/useSnapshot.ts
// Debug 快照 hook:封装 POST 创建快照 + PATCH 追加描述。
// 不触碰 WS 连接、不调 sendAction、不改游戏渲染状态树——只读旁路。
import { useState, useCallback } from 'react';
import type { GameView } from '../../engine/types';

export interface UseSnapshotResult {
  /** 是否正在保存中(POST 进行中,按钮应禁用) */
  saving: boolean;
  /** 错误信息(有则 toast 显示) */
  error: string | null;
  /** 已保存的 snapshotId(成功后用于 PATCH 描述) */
  lastSnapshotId: string | null;
  /** 已保存的文件路径(成功后显示给用户) */
  lastSnapshotPath: string | null;
  /** 创建快照:收集各座次 view/seq + perspective,POST 到后端 */
  createSnapshot: (params: {
    roomId: string;
    perspective: number;
    views: Map<number, GameView>;
    getSeqForView: (seat: number) => number;
  }) => Promise<string | null>;
  /** 追加描述到最近一次快照 */
  patchDescription: (snapshotId: string, description: string) => Promise<boolean>;
  /** 清除错误 */
  clearError: () => void;
}

export function useSnapshot(): UseSnapshotResult {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  const [lastSnapshotPath, setLastSnapshotPath] = useState<string | null>(null);

  const createSnapshot = useCallback(async (params: {
    roomId: string;
    perspective: number;
    views: Map<number, GameView>;
    getSeqForView: (seat: number) => number;
  }): Promise<string | null> => {
    setSaving(true);
    setError(null);
    try {
      const frontendSeqs: Record<string, number> = {};
      const frontendViews: Record<string, GameView> = {};
      for (const [seat, view] of params.views) {
        frontendSeqs[String(seat)] = params.getSeqForView(seat);
        frontendViews[String(seat)] = view;
      }
      const resp = await fetch('/api/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: params.roomId,
          perspective: params.perspective,
          frontendSeqs,
          frontendViews,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `保存失败 (${resp.status})`);
      }
      const data = await resp.json() as { snapshotId: string };
      setLastSnapshotId(data.snapshotId);
      setLastSnapshotPath(`data/snapshots/${data.snapshotId}.json`);
      return data.snapshotId;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const patchDescription = useCallback(async (snapshotId: string, description: string): Promise<boolean> => {
    setError(null);
    try {
      const resp = await fetch(`/api/snapshot/${snapshotId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `描述保存失败 (${resp.status})`);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    saving,
    error,
    lastSnapshotId,
    lastSnapshotPath,
    createSnapshot,
    patchDescription,
    clearError,
  };
}
```

- [ ] **Step 2: 验证 typecheck**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/client/hooks/useSnapshot.ts
git commit -m "feat: 新建 useSnapshot hook"
```

---

## Task 6: 前端 — DebugPerspectiveBar 加按钮 + 描述输入 UI

**Files:**
- Modify: `src/client/components/DebugPerspectiveBar.tsx`
- Modify: `src/client/components/gameViewStyles.ts`

- [ ] **Step 1: 在 gameViewStyles.ts 添加快照相关样式**

在 `src/client/components/gameViewStyles.ts` 末尾(debug 样式区附近)添加:

```ts
// ─── Debug 快照 ───
export const snapshotBtn = css`
  background: #2d4a2d; color: #7ee787; border: 1px solid #4a8a4a;
  padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 13px;
  &:hover { background: #3d5a3d; }
  &:disabled { opacity: 0.5; cursor: wait; }
`;
export const snapshotToast = css`
  position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
  background: #1f3d1f; color: #7ee787; padding: 10px 20px; border-radius: 6px;
  border: 1px solid #4a8a4a; font-size: 13px; z-index: 9999;
`;
export const snapshotErrorToast = css`
  position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
  background: #3d1f1f; color: #ff7b72; padding: 10px 20px; border-radius: 6px;
  border: 1px solid #8a4a4a; font-size: 13px; z-index: 9999;
`;
export const snapshotDescOverlay = css`
  position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 10000;
  display: flex; align-items: center; justify-content: center;
`;
export const snapshotDescBox = css`
  background: #1a1a2e; padding: 20px; border-radius: 8px; border: 1px solid #444;
  display: flex; flex-direction: column; gap: 12px; min-width: 400px;
`;
export const snapshotDescTitle = css`
  color: #7ee787; font-size: 15px; font-weight: bold;
`;
export const snapshotDescInput = css`
  background: #111; color: #ddd; border: 1px solid #444; border-radius: 4px;
  padding: 8px; font-size: 14px; min-height: 60px; resize: vertical;
`;
export const snapshotDescActions = css`
  display: flex; gap: 8px; justify-content: flex-end;
`;
export const snapshotDescBtn = css`
  background: #2d4a2d; color: #7ee787; border: 1px solid #4a8a4a;
  padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px;
  &:hover { background: #3d5a3d; }
`;
export const snapshotDescCancelBtn = css`
  background: #333; color: #aaa; border: 1px solid #555;
  padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px;
  &:hover { background: #444; }
`;
```

- [ ] **Step 2: 在 DebugPerspectiveBar.tsx 加按钮和描述弹框**

修改 `src/client/components/DebugPerspectiveBar.tsx`,在现有 import 后添加快照 UI。完整新文件:

```tsx
// src/client/components/DebugPerspectiveBar.tsx
// debug 模式视角控制栏:视角切换 / 跳转当前玩家 / 自动跟随开关 / 退出房间 / 保存快照。
// 由上层(DebugLobby)渲染到 GameViewComponent 的 headerSlot / overlaySlot,
// GameViewComponent 本身不感知视角切换。
import { useState } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';

export interface DebugPerspectiveBarProps {
  perspectiveName: string;
  onSwitchPerspective?: () => void;
  /** 切到下一个未选将座次(选将阶段专用)。 */
  onSwitchToNextUnselected?: () => void;
  onGoToCurrentPlayer?: () => void;
  autoSwitchCtl?: { enabled: boolean; toggle: () => void };
  /** 退出/删除房间(可选;渲染「退出」按钮)。 */
  onDeleteRoom?: () => void;
  /** 保存快照(可选;渲染「保存快照」按钮)。 */
  onSaveSnapshot?: () => void;
  snapshotSaving?: boolean;
  snapshotToast?: string | null;
  snapshotError?: string | null;
}

export function DebugPerspectiveBar({
  perspectiveName,
  onSwitchPerspective,
  onSwitchToNextUnselected,
  onGoToCurrentPlayer,
  autoSwitchCtl,
  onDeleteRoom,
  onSaveSnapshot,
  snapshotSaving,
  snapshotToast,
  snapshotError,
}: DebugPerspectiveBarProps) {
  if (!onSwitchPerspective && !onDeleteRoom && !onSwitchToNextUnselected && !onSaveSnapshot) return null;
  return (
    <div className={styles.headerRight}>
      {onDeleteRoom && <button className={styles.backBtn} onClick={onDeleteRoom}>← 退出</button>}
      {onSwitchToNextUnselected && (
        <button className={styles.goToBtn} onClick={onSwitchToNextUnselected}>下一个待选者</button>
      )}
      {onSwitchPerspective && (
        <button className={styles.perspectiveBtn} onClick={onSwitchPerspective}>
          视角: {perspectiveName}
        </button>
      )}
      {onGoToCurrentPlayer && <button className={styles.goToBtn} onClick={onGoToCurrentPlayer}>查看当前玩家</button>}
      {autoSwitchCtl && (
        <button
          className={cx(styles.goToBtn, autoSwitchCtl.enabled && styles.autoSwitchActive)}
          onClick={autoSwitchCtl.toggle}
        >
          自动切换{autoSwitchCtl.enabled ? '✓' : '✗'}
        </button>
      )}
      {onSaveSnapshot && (
        <button
          className={styles.snapshotBtn}
          onClick={onSaveSnapshot}
          disabled={snapshotSaving}
        >
          {snapshotSaving ? '保存中…' : '保存快照'}
        </button>
      )}
      {snapshotToast && <div className={styles.snapshotToast}>{snapshotToast}</div>}
      {snapshotError && <div className={styles.snapshotErrorToast}>{snapshotError}</div>}
    </div>
  );
}
```

- [ ] **Step 3: 验证 typecheck**

Run: `npx tsc --noEmit`
Expected: 无新增错误(DebugLobby 还没传新 props,TS 因可选 props 不报错)

- [ ] **Step 4: Commit**

```bash
git add src/client/components/DebugPerspectiveBar.tsx src/client/components/gameViewStyles.ts
git commit -m "feat: DebugPerspectiveBar 加保存快照按钮 + 描述弹框样式"
```

---

## Task 7: 前端 — useDebugMultiConnection 暴露 getSeq

`lastSeq` 存在于 `useDebugMultiConnection` 内部 `SeatInfo`(seatsRef),但未暴露在返回值。快照需要各座次 seq,需先暴露它。

**Files:**
- Modify: `src/client/hooks/useDebugMultiConnection.ts`

- [ ] **Step 1: 在返回值类型加 getSeq**

修改 `src/client/hooks/useDebugMultiConnection.ts` 的返回值类型定义(第 56-62 行附近),加一个 `getSeq` 方法:

```ts
): {
  views: Map<number, GameView>;
  currentEvent: import('./useEventPlayback').QueuedEvent | null;
  sendAction: (action: ActionMsg) => void;
  reorderHand: (order: string[]) => void;
  disconnectAll: () => void;
  getSeq: (seat: number) => number;
} {
```

- [ ] **Step 2: 实现 getSeq 并加入返回对象**

在 hook 函数体末尾的 return 语句前(找现有的 `return {` 处),添加 getSeq:

```ts
  const getSeq = useCallback((seat: number): number => {
    return seatsRef.current.get(seat)?.lastSeq ?? 0;
  }, []);
```

在 return 对象里加入:

```ts
  return {
    views,
    currentEvent: playback.currentEvent,
    sendAction,
    reorderHand,
    disconnectAll,
    getSeq,
  };
```

(字段名以现有 return 为准,只追加 `getSeq`)

- [ ] **Step 3: 验证 typecheck**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add src/client/hooks/useDebugMultiConnection.ts
git commit -m "feat: useDebugMultiConnection 暴露 getSeq 供快照使用"
```

---

## Task 8: 前端 — DebugLobby 接入快照

**Files:**
- Modify: `src/client/components/DebugLobby.tsx`

- [ ] **Step 1: 在 DebugGameViewInner 接入 useSnapshot**

在 `src/client/components/DebugLobby.tsx` 的 `DebugGameViewInner` 函数里:

顶部 import 添加:

```ts
import { useSnapshot } from '../hooks/useSnapshot';
```

在 `DebugGameViewInner` 函数体内,`const conn = useDebugMultiConnection(...)` 之后、`const currentView = ...` 之前添加快照逻辑:

```ts
const snap = useSnapshot();

const handleSaveSnapshot = useCallback(async () => {
  const snapshotId = await snap.createSnapshot({
    roomId,
    perspective,
    views: conn.views,
    getSeqForView: (seat) => conn.getSeq(seat),
  });
  if (snapshotId) {
    // 弹描述输入框由 snap 状态驱动,这里用 window.prompt 简化
    // (或后续可改为受控弹框组件)
    const desc = window.prompt('快照已保存。请描述你发现的 bug(可留空):');
    if (desc !== null && desc.trim()) {
      await snap.patchDescription(snapshotId, desc.trim());
    }
  }
}, [snap, roomId, perspective, conn]);

// 3 秒后自动清除 toast
useEffect(() => {
  if (snap.lastSnapshotPath || snap.error) {
    const t = setTimeout(() => snap.clearError(), 3000);
    return () => clearTimeout(t);
  }
}, [snap.lastSnapshotPath, snap.error, snap]);
```

注意需要在文件顶部确保 `useCallback`、`useEffect` 已从 react import(检查现有 import,`import { useState, useMemo } from 'react'` → 改为 `import { useState, useMemo, useCallback, useEffect } from 'react'`)。

然后修改 `headerBar` 和 `overlayBar` 两个 `DebugPerspectiveBar` 的渲染,添加快照 props:

```tsx
const headerBar = (
  <DebugPerspectiveBar
    perspectiveName={perspectiveName}
    onSwitchPerspective={pctl.switchPerspective}
    onGoToCurrentPlayer={pctl.goToCurrentPlayer}
    autoSwitchCtl={pctl.autoSwitchCtl}
    onDeleteRoom={onDeleteRoom}
    onSaveSnapshot={handleSaveSnapshot}
    snapshotSaving={snap.saving}
    snapshotToast={snap.lastSnapshotPath ? `已保存: ${snap.lastSnapshotPath}` : null}
    snapshotError={snap.error}
  />
);
```

`overlayBar` 同样添加这三个 props(`onSaveSnapshot`/`snapshotSaving`/`snapshotToast`/`snapshotError`)。

- [ ] **Step 2: 验证 typecheck**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/client/components/DebugLobby.tsx
git commit -m "feat: DebugLobby 接入快照功能"
```

---

## Task 9: 端到端验证

**Files:** 无(手动验证)

- [ ] **Step 1: 启动 dev server

Run: `npm run dev`

- [ ] **Step 2: 开 debug 房间玩几轮**

浏览器打开 debug 页面,创建房间,开始游戏,进行几轮操作产生状态。

- [ ] **Step 3: 点"保存快照"按钮**

验证:
- 按钮显示"保存中…"然后恢复
- 出现 toast "已保存: data/snapshots/xxx.json"
- 弹出 prompt 输入描述

- [ ] **Step 4: 检查快照文件**

读取生成的快照文件,验证:
- 含 meta/alignment/backend/frontend 四块
- backend.state 有 players/hand/equipment
- backend.actionLog 非空
- backend.atomHistory 非空
- backend.state.pendingSlotsData 有数据(若当时有 pending)
- frontend.views 有各座次 view
- alignment.frontendSeqs 和 backendSeq 有值

- [ ] **Step 5: 验证不干扰游戏**

快照后继续出牌/响应,游戏正常进行不中断。

- [ ] **Step 6: 全量 typecheck + 测试**

Run: `npx tsc --noEmit && npx vitest run tests/server/snapshot.test.ts`
Expected: typecheck 无新增错误,测试全过
