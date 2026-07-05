# MCP reportBug 工具 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为三国杀 MCP server 新增第三个工具 `reportBug`,让 AI agent 在对局中发现 bug 时把描述 + 结构化字段 + 自动游戏快照写入本地 JSON 文件。

**Architecture:** 新建 `src/ai-mcp/feedbackHandler.ts`(`reportBugResult` 纯逻辑 + `node:fs` 写盘),在 `src/ai-mcp/mcpServer.ts` 注册 `REPORT_BUG_TOOL` 并加 `tools/call` 分支。快照走只读路径(`projectView(hgc.view)` + `hgc.getAvailableActions()`),不调 `drainNewEvents`,对 `play` 阻塞循环零副作用。

**Tech Stack:** TypeScript、Node.js `fs/promises`、vitest、手写 JSON-RPC MCP server(无官方 SDK)。

**Spec:** `docs/superpowers/specs/2026-07-05-mcp-feedback-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/ai-mcp/feedbackHandler.ts` | 新建 | `reportBugResult(input, hgc)` + 类型 + 落盘逻辑 |
| `src/ai-mcp/mcpServer.ts` | 改 | `REPORT_BUG_TOOL` 常量、`tools/list` 加入、`tools/call` 加 `reportBug` 分支 |
| `tests/ai-mcp/mcpServer.test.ts` | 改 | feedbackHandler 单测 + mcpServer 集成测试(归并,遵循 AGENTS.md) |

---

### Task 1: feedbackHandler — reportBugResult 与落盘

**Files:**
- Create: `src/ai-mcp/feedbackHandler.ts`
- Test: `tests/ai-mcp/mcpServer.test.ts`(在现有 describe 外新增 `describe('reportBugResult', ...)`)

- [ ] **Step 1: 写失败测试**

在 `tests/ai-mcp/mcpServer.test.ts` **顶部 import 区**追加:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  reportBugResult,
  resolveFeedbackDir,
  type ReportBugInput,
} from '../../src/ai-mcp/feedbackHandler';
```

在文件**末尾**(现有 `describe('handleMcpRequest', ...)` 块之后)追加新 describe:

```ts
/** 构造最小 GameView stub,足够 projectView 不报错。 */
function makeStubView() {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: 'play',
    turn: { round: 1 },
    players: [],
    pending: null,
    zones: { deckCount: 10, discardPileCount: 0 },
    log: [],
  } as unknown as Parameters<typeof import('../../src/ai-mcp/viewProjector').projectView>[0];
}

describe('reportBugResult', () => {
  it('写入文件包含 agent 字段和自动快照', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    process.env.SGS_FEEDBACK_DIR = tmpDir;
    try {
      const drainNewEvents = vi.fn(() => []);
      const hgc = makeFakeHgc({
        view: makeStubView(),
        getAvailableActions: () => [
          { description: 'x', message: {} as never, validTargets: [], category: 'play' },
        ],
        drainNewEvents,
        roomId: 'ROOM1',
        seatIndex: 0,
        phase: 'playing',
      });
      const res = await reportBugResult(
        { description: 'bug X', severity: 'high', category: 'skill-settlement' },
        hgc,
      );
      expect(res.ok).toBe(true);
      expect(res.id).toMatch(/^[A-Za-z0-9]{6}$/);
      const content = JSON.parse(await fs.readFile(res.path, 'utf8'));
      expect(content.description).toBe('bug X');
      expect(content.severity).toBe('high');
      expect(content.category).toBe('skill-settlement');
      expect(content.reporter.roomId).toBe('ROOM1');
      expect(content.reporter.seat).toBe(0);
      expect(content.reporter.phase).toBe('playing');
      expect(content.snapshot.view).not.toBeNull();
      expect(content.snapshot.availableActions).toHaveLength(1);
      // 关键:reportBug 不得调用消费式 drainNewEvents
      expect(drainNewEvents).not.toHaveBeenCalled();
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('view 为 null 时 snapshot.view 为 null 仍落盘,severity/category 走默认', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    process.env.SGS_FEEDBACK_DIR = tmpDir;
    try {
      const hgc = makeFakeHgc({ view: null, phase: 'lobby' });
      const res = await reportBugResult({ description: 'lobby bug' }, hgc);
      const content = JSON.parse(await fs.readFile(res.path, 'utf8'));
      expect(content.snapshot.view).toBeNull();
      expect(content.severity).toBe('medium');
      expect(content.category).toBe('other');
      expect(content.reporter.phase).toBe('lobby');
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('目录不存在时自动创建(嵌套)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    const nested = path.join(tmpDir, 'nested', 'dir');
    process.env.SGS_FEEDBACK_DIR = nested;
    try {
      const hgc = makeFakeHgc({ view: null });
      const res = await reportBugResult({ description: 'mkdir test' }, hgc);
      const stat = await fs.stat(res.path);
      expect(stat.isFile()).toBe(true);
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('文件名格式 YYYYMMDDTHHMMSS-<6位>.json', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    process.env.SGS_FEEDBACK_DIR = tmpDir;
    try {
      const hgc = makeFakeHgc({ view: null });
      const res = await reportBugResult({ description: 'name test' }, hgc);
      expect(path.basename(res.path)).toMatch(/^\d{8}T\d{6}-[A-Za-z0-9]{6}\.json$/);
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('description 缺失或空抛错', async () => {
    const hgc = makeFakeHgc({ view: null });
    await expect(reportBugResult({ description: '' }, hgc)).rejects.toThrow();
    await expect(reportBugResult({ description: '   ' }, hgc)).rejects.toThrow();
  });

  it('expected/actual 缺失时落盘为 null', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    process.env.SGS_FEEDBACK_DIR = tmpDir;
    try {
      const hgc = makeFakeHgc({ view: null });
      const res = await reportBugResult({ description: 'no expected' }, hgc);
      const content = JSON.parse(await fs.readFile(res.path, 'utf8'));
      expect(content.expected).toBeNull();
      expect(content.actual).toBeNull();
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolveFeedbackDir 默认 data/ai-feedback,环境变量覆盖', () => {
    delete process.env.SGS_FEEDBACK_DIR;
    expect(resolveFeedbackDir()).toBe('data/ai-feedback');
    process.env.SGS_FEEDBACK_DIR = '/tmp/custom-fb';
    expect(resolveFeedbackDir()).toBe('/tmp/custom-fb');
    delete process.env.SGS_FEEDBACK_DIR;
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/projects/sanguosha && npm run test -- tests/ai-mcp/mcpServer.test.ts`
Expected: FAIL,`Cannot find module '../../src/ai-mcp/feedbackHandler'`

- [ ] **Step 3: 实现 feedbackHandler.ts**

创建 `src/ai-mcp/feedbackHandler.ts`:

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd ~/projects/sanguosha && npm run test -- tests/ai-mcp/mcpServer.test.ts`
Expected: PASS,新增 7 个 reportBugResult 用例全过,原有用例不破。

- [ ] **Step 5: 提交**

```bash
cd ~/projects/sanguosha && git add src/ai-mcp/feedbackHandler.ts tests/ai-mcp/mcpServer.test.ts && git commit -m "feat(ai-mcp): 新增 feedbackHandler reportBugResult 落盘逻辑"
```

---

### Task 2: mcpServer 注册 reportBug 工具

**Files:**
- Modify: `src/ai-mcp/mcpServer.ts`
- Test: `tests/ai-mcp/mcpServer.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/ai-mcp/mcpServer.test.ts` 顶部 import 区,把现有:

```ts
import {
  handleMcpRequest,
  PLAY_TOOL,
  SKILL_INFO_TOOL,
  type McpHandlerContext,
} from '../../src/ai-mcp/mcpServer';
```

改为:

```ts
import {
  handleMcpRequest,
  PLAY_TOOL,
  SKILL_INFO_TOOL,
  REPORT_BUG_TOOL,
  type McpHandlerContext,
} from '../../src/ai-mcp/mcpServer';
```

把 `tools/list` 测试从:

```ts
  it('tools/list 返回 play 与 getSkillInfo 工具定义', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx);
    const tools = (res!.result as { tools: (typeof PLAY_TOOL)[] }).tools;
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['play', 'getSkillInfo']);
    expect(tools[0].inputSchema).toBeDefined();
    expect(tools[1].inputSchema).toBeDefined();
    expect(SKILL_INFO_TOOL.inputSchema).toBeDefined();
  });
```

改为:

```ts
  it('tools/list 返回 play、getSkillInfo、reportBug 工具定义', async () => {
    const ctx = makeCtx(makeFakeHgc());
    const res = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx);
    const tools = (res!.result as { tools: (typeof PLAY_TOOL)[] }).tools;
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(['play', 'getSkillInfo', 'reportBug']);
    expect(tools[0].inputSchema).toBeDefined();
    expect(tools[1].inputSchema).toBeDefined();
    expect(tools[2].inputSchema).toBeDefined();
    expect(SKILL_INFO_TOOL.inputSchema).toBeDefined();
    expect(REPORT_BUG_TOOL.inputSchema).toBeDefined();
  });
```

在 `describe('handleMcpRequest', ...)` 块**内末尾**(最后一个 `it` 之后)追加集成测试:

```ts
  it('tools/call reportBug 返回 ok 且文件落盘', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sgs-fb-'));
    process.env.SGS_FEEDBACK_DIR = tmpDir;
    try {
      const hgc = makeFakeHgc({ view: null, phase: 'playing', roomId: 'R1' });
      const ctx = makeCtx(hgc);
      const res = await handleMcpRequest(
        {
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/call',
          params: {
            name: 'reportBug',
            arguments: {
              description: '杀的伤害没结算',
              severity: 'high',
              category: 'skill-settlement',
              expected: '掉 1 血',
              actual: '没掉血',
            },
          },
        },
        ctx,
      );
      expect(res).not.toBeNull();
      const sc = res!.result!.structuredContent as {
        ok: boolean;
        id: string;
        path: string;
        timestamp: string;
      };
      expect(sc.ok).toBe(true);
      const content = JSON.parse(await fs.readFile(sc.path, 'utf8'));
      expect(content.description).toBe('杀的伤害没结算');
      expect(content.severity).toBe('high');
      expect(content.expected).toBe('掉 1 血');
      expect(content.actual).toBe('没掉血');
    } finally {
      delete process.env.SGS_FEEDBACK_DIR;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('tools/call reportBug 缺 description 返回 -32602', async () => {
    const ctx = makeCtx(makeFakeHgc({ view: null }));
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: { name: 'reportBug', arguments: { severity: 'high' } },
      },
      ctx,
    );
    expect(res!.error).toBeDefined();
    expect(res!.error!.code).toBe(-32602);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/projects/sanguosha && npm run test -- tests/ai-mcp/mcpServer.test.ts`
Expected: FAIL,`REPORT_BUG_TOOL` 未导出 / `reportBug` 工具未注册。

- [ ] **Step 3: 在 mcpServer.ts 加 REPORT_BUG_TOOL 常量**

在 `src/ai-mcp/mcpServer.ts` 现有 `SKILL_INFO_TOOL` 常量定义**之后**追加:

```ts
/** reportBug 工具的输入 schema:agent 对局中发现 bug 时落盘反馈。 */
export const REPORT_BUG_TOOL = {
  name: 'reportBug',
  description:
    'AI agent 在三国杀对局中发现 bug 时调用:把问题描述 + 结构化字段 + 当时的游戏状态快照写入本地 JSON 文件。' +
    '不影响游戏进程。返回文件路径和 id。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      description: { type: 'string', description: 'bug 描述,自由文本' },
      severity: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: '严重程度,默认 medium',
      },
      category: {
        type: 'string',
        enum: ['skill-settlement', 'state-inconsistency', 'ui', 'rule-violation', 'other'],
        description: '分类,默认 other',
      },
      expected: { type: 'string', description: '期望行为(可选)' },
      actual: { type: 'string', description: '实际行为(可选)' },
    },
    required: ['description'],
  },
};
```

- [ ] **Step 4: 在 mcpServer.ts 顶部加 import**

在 `import { runPlay } from './playHandler';` 这一行**之后**追加:

```ts
import { reportBugResult, type ReportBugInput } from './feedbackHandler';
```

- [ ] **Step 5: tools/list 数组加入 reportBug**

在 `handleMcpRequest` 的 `case 'tools/list':` 分支,把:

```ts
        return { jsonrpc: '2.0', id, result: { tools: [PLAY_TOOL, SKILL_INFO_TOOL] } };
```

改为:

```ts
        return { jsonrpc: '2.0', id, result: { tools: [PLAY_TOOL, SKILL_INFO_TOOL, REPORT_BUG_TOOL] } };
```

- [ ] **Step 6: tools/call 加 reportBug 分支**

在 `case 'tools/call':` 内,现有 `if (params.name === 'getSkillInfo') { ... }` 块**之后**、`if (params.name !== 'play') { ... }` **之前**,插入:

```ts
        if (params.name === 'reportBug') {
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          const description = typeof args.description === 'string' ? args.description : '';
          if (!description.trim()) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'description is required' },
            };
          }
          const input: ReportBugInput = {
            description,
            severity: args.severity as ReportBugInput['severity'],
            category: args.category as ReportBugInput['category'],
            expected: typeof args.expected === 'string' ? args.expected : undefined,
            actual: typeof args.actual === 'string' ? args.actual : undefined,
          };
          const result = await reportBugResult(input, ctx.hgc);
          const text = JSON.stringify(result);
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }], structuredContent: result },
          };
        }
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd ~/projects/sanguosha && npm run test -- tests/ai-mcp/mcpServer.test.ts`
Expected: PASS,全部用例(含新增 2 个集成 + 7 个单测)通过。

- [ ] **Step 8: 提交**

```bash
cd ~/projects/sanguosha && git add src/ai-mcp/mcpServer.ts tests/ai-mcp/mcpServer.test.ts && git commit -m "feat(ai-mcp): mcpServer 注册 reportBug 工具"
```

---

### Task 3: 全量验证

**Files:** 无修改

- [ ] **Step 1: TypeScript 类型检查**

Run: `cd ~/projects/sanguosha && npm run typecheck`
Expected: 无错误退出码 0。

- [ ] **Step 2: 运行 core 全量测试,确认无回归**

Run: `cd ~/projects/sanguosha && npm run test`
Expected: 全部通过,无回归。

- [ ] **Step 3: 如有修改则提交,否则跳过**

仅当 Step 1/2 触发任何修复时:

```bash
cd ~/projects/sanguosha && git add -A && git commit -m "fix: reportBug 全量验证修复"
```

---

## Self-Review 结果

**1. Spec 覆盖:** 逐条核对 spec 验收标准:
- 验收 1(tools/list 含 reportBug)→ Task 2 Step 5 + 测试
- 验收 2(落盘含 agent 字段 + 快照)→ Task 1 Step 1 测试 + Task 2 集成测试
- 验收 3(不影响 play 的 recentEvents)→ Task 1 测试断言 `drainNewEvents` 未被调用 + 实现注释明确禁止
- 验收 4(SGS_FEEDBACK_DIR 覆盖)→ Task 1 `resolveFeedbackDir` 测试
- 验收 5(view null 仍落盘)→ Task 1 "view 为 null" 测试
- 验收 6(写盘失败返回 error 不崩)→ mcpServer 的 catch 兜底(已有,`-32603`),description 缺失返回 `-32602`(Task 2 测试)
- 验收 7(tsc + 测试通过)→ Task 3

**2. Placeholder 扫描:** 无 TBD/TODO,所有代码块完整。

**3. 类型一致性:** `ReportBugInput`/`ReportBugResult`/`FeedbackSeverity`/`FeedbackCategory` 在 Task 1 定义,Task 2 import 复用,命名一致。`REPORT_BUG_TOOL` 常量名与测试 import 一致。
