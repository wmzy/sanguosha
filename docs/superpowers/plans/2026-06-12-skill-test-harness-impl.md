# Skill Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为三国杀引擎引入 `SkillTestHarness` + `PlayerSession` + `FakeFrontendAPI` 测试基础设施,使技能能通过真实 `createEngine()` + `onMount` 虚拟前端进行端到端集成测试,无需 DOM/WebSocket。

**Architecture:** 引擎新增 `engine.fireTimeout()` 内部接口驱动 `PendingSlot` 的 onTimeout 路径;`tests/engine-harness.ts` 单文件实现三件套(200 行内)——`FakeFrontendAPI` 收集 `defineAction` 声明,`PlayerSession` 包装玩家操作/查询/断言,`SkillTestHarness` 管理 engine 生命周期和 player 索引;vitest 4 `projects` 数组将核心测试与技能测试分区(技能项目用 `forks` 池隔离全局状态)。

**Tech Stack:** vitest 4.1(`projects` 数组 + `forks` pool),TypeScript 5.9,无新依赖

**Spec:** [`docs/superpowers/specs/2026-06-12-skill-test-harness-impl-design.md`](../specs/2026-06-12-skill-test-harness-impl-design.md) (P0-P3 + 杀示范)

---

## File Map

### 新增文件(4 个)

| 路径 | 职责 |
|---|---|
| `tests/engine-harness.ts` | `SkillTestHarness` + `PlayerSession` + `FakeFrontendAPI` + `ActionDef` |
| `tests/integration/new-engine-fire-timeout.test.ts` | `engine.fireTimeout()` 单元测试(归 core 项目) |
| `tests/skill-tests/杀.test.ts` | 技能测试示范 3 case(归 skills 项目) |
| `tests/skill-tests/contract.test.ts` | 前后端契约验证骨架(归 skills 项目) |

### 修改文件(5 个)

| 路径 | 改动 |
|---|---|
| `src/engine/types.ts` | `PendingSlot` 加 `_fireTimeoutNow?: () => Promise<void>` |
| `src/engine/engine-api.ts` | 提取 `fireTimeoutNow` 函数并挂到 `slot._fireTimeoutNow` |
| `src/engine/create-engine.ts` | `EngineInstance` 接口加 `fireTimeout()`,返回 `DispatchResult` |
| `vitest.config.ts` | 改为 `projects: [{name: 'core', ...}, {name: 'skills', pool: 'forks', ...}]` |
| `package.json` | scripts: `test` → `--project core`;新增 `test:skills` / `test:all` / `test:skills:watch` |

### 不动文件(共存策略)

- `tests/integration/new-engine-kill.test.ts`(回归保护,后续 PR 删)
- `tests/scenarios/**`、`tests/scenario-runner.ts`、`tests/engine-helpers.ts`(P4 迁移)

---

## Task 1: 引擎暴露 `fireTimeout()` —— TDD

**Files:**
- Create: `tests/integration/new-engine-fire-timeout.test.ts`
- Modify: `src/engine/types.ts:408-415`(`PendingSlot` 加字段)
- Modify: `src/engine/engine-api.ts:142-185`(timer 提取)
- Modify: `src/engine/create-engine.ts:51-60, 134-274`(接口 + 实现)

- [ ] **Step 1.1: 写失败测试**

在 `tests/integration/new-engine-fire-timeout.test.ts` 写入:

```ts
// tests/integration/new-engine-fire-timeout.test.ts
// 引擎 fireTimeout() 单元测试(归 core 项目)
import { describe, it, expect, beforeEach } from 'vitest';
import { createEngine, type EngineInstance } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function buildInitialState(): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true,
        hand: ['c1'], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '反贼', health: 4, maxHealth: 4, alive: true,
        hand: [], equipment: {}, skills: ['闪'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: { c1: slash },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('engine.fireTimeout', () => {
  let engine: EngineInstance;
  beforeEach(() => {
    engine = createEngine();
    engine.resetForTest();
    engine.bootstrap(buildInitialState());
  });

  it('无 pending 时调用:返回当前 state,不抛错', async () => {
    const before = engine.getState();
    const result = await engine.fireTimeout();
    expect(result.state).toBe(before);
    expect(result.gameOver).toBeFalsy();
  });

  it('有 pending(询问闪)时调用:触发 onTimeout → pending 清空 → P2 扣 1 血', async () => {
    await engine.dispatch({
      skillId: '杀', actionType: 'use', ownerId: 'P1',
      params: { cardId: 'c1', targets: ['P2'] }, baseSeq: 0,
    });
    expect(engine.getState().pendingSlot).toBeDefined();

    await engine.fireTimeout();
    expect(engine.getState().pendingSlot).toBeUndefined();
    const p2 = engine.getState().players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
  });
});
```

- [ ] **Step 1.2: 运行测试,验证失败**

```bash
cd /home/zlt/projects/sanguosha && pnpm vitest run tests/integration/new-engine-fire-timeout.test.ts
```

Expected: FAIL with "Property 'fireTimeout' does not exist on type 'EngineInstance'"

- [ ] **Step 1.3: `PendingSlot` 加内部字段**

修改 `src/engine/types.ts`,在 `PendingSlot` 接口中(在 `resolve: () => void;` 之后)添加:

```ts
export interface PendingSlot {
  atom: Atom;
  definition: AtomDefinition;
  startTime: number;
  deadline: number;
  resolve: () => void;
  /** 内部:由 engine-api 在创建 pending 时挂上,供 engine.fireTimeout 立即触发 onTimeout。
   *  属于引擎内部钩子,不属于 PendingSlot 对外契约(下划线前缀 + 可选)。 */
  _fireTimeoutNow?: () => Promise<void>;
}
```

- [ ] **Step 1.4: 提取 `fireTimeoutNow` 函数**

修改 `src/engine/engine-api.ts`,把 `apply` 函数中 `pending` 分支(约第 142-185 行,`// pending?` 注释到 `});` 之间)的 `setTimeout` 替换:

**Before:**
```ts
// pending?
if (def.pending) {
  await new Promise<void>((resolve) => {
    const pending = def.pending!;
    const timeoutMs = pending.timeout * 1000;
    let resolveCalled = false;
    const safeResolve = () => {
      if (resolveCalled) return;
      resolveCalled = true;
      clearTimeout(timer);
      resolve();
    };
    const slot: PendingSlot = {
      atom,
      definition: def,
      startTime: Date.now(),
      deadline: Date.now() + timeoutMs,
      resolve: safeResolve,
    };
    // 等待替换语义:新 wait 入 slot 前,旧 slot 直接 resolve(不 fire onTimeout)
    if (ctx.state.pendingSlot) {
      ctx.state.pendingSlot.resolve();
      ctx.state = { ...ctx.state, pendingSlot: undefined };
    }
    ctx.state = { ...ctx.state, pendingSlot: slot };

    // 引擎内部管理超时定时器(必填——onTimeout 必填)
    const timer = setTimeout(async () => {
      // 仅当此 slot 仍是当前 slot 时才 fire(避免旧 slot 残留触发)
      if (ctx.state.pendingSlot === slot) {
        ctx.state = { ...ctx.state, pendingSlot: undefined };
        // 执行 onTimeout atom
        await api.apply(pending.onTimeout);
      }
      safeResolve();
    }, timeoutMs);

    // 通知 dispatch:帧已抵达挂起点,可以返回当前 state
    ctx.fireDispatchReady();
  });
}
```

**After:**
```ts
// pending?
if (def.pending) {
  await new Promise<void>((resolve) => {
    const pending = def.pending!;
    const timeoutMs = pending.timeout * 1000;
    let resolveCalled = false;
    const safeResolve = () => {
      if (resolveCalled) return;
      resolveCalled = true;
      clearTimeout(timer);
      resolve();
    };
    const slot: PendingSlot = {
      atom,
      definition: def,
      startTime: Date.now(),
      deadline: Date.now() + timeoutMs,
      resolve: safeResolve,
    };
    // 等待替换语义:新 wait 入 slot 前,旧 slot 直接 resolve(不 fire onTimeout)
    if (ctx.state.pendingSlot) {
      ctx.state.pendingSlot.resolve();
      ctx.state = { ...ctx.state, pendingSlot: undefined };
    }
    ctx.state = { ...ctx.state, pendingSlot: slot };

    // 提取 timer 回调为可复用函数,挂到 slot._fireTimeoutNow 供测试立即触发
    const fireTimeoutNow = async (): Promise<void> => {
      // 仅当此 slot 仍是当前 slot 时才 fire(避免旧 slot 残留触发)
      if (ctx.state.pendingSlot !== slot) return;
      clearTimeout(timer);
      ctx.state = { ...ctx.state, pendingSlot: undefined };
      // 执行 onTimeout atom
      await api.apply(pending.onTimeout);
      safeResolve();
    };
    slot._fireTimeoutNow = fireTimeoutNow;

    // 引擎内部管理超时定时器(必填——onTimeout 必填)
    const timer = setTimeout(fireTimeoutNow, timeoutMs);

    // 通知 dispatch:帧已抵达挂起点,可以返回当前 state
    ctx.fireDispatchReady();
  });
}
```

- [ ] **Step 1.5: `EngineInstance` 接口加 `fireTimeout()`**

修改 `src/engine/create-engine.ts`:

在 `EngineInstance` 接口(`第 51-60 行`)中添加:

```ts
export interface EngineInstance {
  dispatch(message: ClientMessage): Promise<DispatchResult>;
  buildView(viewer: number): GameView;
  resetForTest(): void;
  bootstrap(initialState: GameState): GameState;
  /** 重新注册当前 state 中所有玩家的技能(用于初始化游戏后) */
  rebootstrap(): void;
  /** 获取当前 state(只读) */
  getState(): GameState;
  /** 测试用:立即触发当前 pending 的 onTimeout(模拟超时,绕过真实 setTimeout) */
  fireTimeout(): Promise<DispatchResult>;
}
```

在 `createEngine` 函数内(`rebootstrap` 函数之后,`return` 语句之前)添加 `fireTimeout` 实现:

```ts
  async function fireTimeout(): Promise<DispatchResult> {
    const slot = currentState.pendingSlot;
    if (!slot) return { state: currentState };

    await slot._fireTimeoutNow?.();
    if (activeExecuteP) await activeExecuteP;
    if (activeExecuteCtx) currentState = activeExecuteCtx.state;
    activeExecuteCtx = undefined;
    activeExecuteP = undefined;

    // seq 不递增(不是 ClientMessage)
    const { gameOver, winner } = checkGameOver();
    return { state: currentState, gameOver, winner };
  }
```

修改 `return` 语句包含 `fireTimeout`:

```ts
  return { dispatch, buildView: (viewer) => buildView(currentState, viewer), resetForTest, bootstrap, rebootstrap, getState, fireTimeout };
```

- [ ] **Step 1.6: 运行测试,验证通过**

```bash
cd /home/zlt/projects/sanguosha && pnpm vitest run tests/integration/new-engine-fire-timeout.test.ts
```

Expected: 2 passed

- [ ] **Step 1.7: 跑 core 项目,确保 `engine-api.ts` 改动不破坏现有测试**

```bash
cd /home/zlt/projects/sanguosha && pnpm test
```

Expected: 与改动前同数量测试通过(`new-engine-kill.test.ts` 仍绿)

- [ ] **Step 1.8: 提交**

```bash
cd /home/zlt/projects/sanguosha && git add tests/integration/new-engine-fire-timeout.test.ts src/engine/types.ts src/engine/engine-api.ts src/engine/create-engine.ts
git commit -m "feat(engine): 暴露 fireTimeout() 测试接口(驱动 onTimeout 路径)"
```

---

## Task 2: vitest projects 配置 + package.json scripts

**Files:**
- Modify: `vitest.config.ts`(整文件替换)
- Modify: `package.json:14-23`(scripts 段)

- [ ] **Step 2.1: 替换 `vitest.config.ts`**

整文件替换为:

```ts
/// <reference types="vitest/globals" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const sharedAlias = {
  '@': path.resolve(__dirname, './src/client'),
  '@shared': path.resolve(__dirname, './src/shared'),
  '@engine': path.resolve(__dirname, './src/engine'),
};

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      exclude: [
        'node_modules/', 'dist/', 'tests/',
        '**/*.test.{ts,tsx}', 'scripts/',
        'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts',
      ],
    },
    alias: sharedAlias,

    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['tests/skill-tests/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'skills',
          include: ['tests/skill-tests/**/*.test.ts'],
          pool: 'forks',
          poolOptions: { forks: { isolate: true } },
        },
      },
    ],
  },
});
```

- [ ] **Step 2.2: 创建空的 `tests/skill-tests/` 目录占位**

```bash
mkdir -p /home/zlt/projects/sanguosha/tests/skill-tests
```

(目录里还没有任何 `.test.ts` 文件,但要被 `skills` project 的 `include` 匹配)

- [ ] **Step 2.3: 更新 `package.json` scripts**

修改 `package.json` 的 `"scripts"` 字段,从:

```json
    "test": "vitest run",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest run --coverage",
```

改为:

```json
    "test": "vitest run --project core",
    "test:skills": "vitest run --project skills",
    "test:all": "vitest run",
    "test:watch": "vitest --watch --project core",
    "test:skills:watch": "vitest --watch --project skills",
    "test:coverage": "vitest run --coverage",
```

(`test:coverage` 保留不动,行为为全量)

- [ ] **Step 2.4: 验证 `pnpm test` 行为与改动前一致**

```bash
cd /home/zlt/projects/sanguosha && pnpm test
```

Expected: 与上一步 `pnpm test` 输出相同(都跑 core 项目);可能多了 `new-engine-fire-timeout.test.ts` 的 2 个测试

- [ ] **Step 2.5: 验证 `pnpm test:skills` 不报错(目录为空)**

```bash
cd /home/zlt/projects/sanguosha && pnpm test:skills
```

Expected: 通过,无测试文件(No test files found)且 exit code 0

- [ ] **Step 2.6: 提交**

```bash
cd /home/zlt/projects/sanguosha && git add vitest.config.ts package.json
git commit -m "chore(vitest): 引入 projects 分区(core + skills forks 池隔离)"
```

> 注:`tests/skill-tests/` 空目录在 Task 3 写第一个 `.test.ts` 后才被 git 跟踪,无需占位文件。

---

## Task 3: 引擎测试 harness —— TDD(以 杀.test.ts 为驱动)

**Files:**
- Create: `tests/engine-harness.ts`(单文件 ~200 行)
- Create: `tests/skill-tests/杀.test.ts`(3 个 case)

> 本任务用"先写杀.test.ts → 运行失败 → 实现 harness → 跑通"模式。
> 写测试是设计 API 的过程,实现 harness 是让测试通过的过程。

- [ ] **Step 3.1: 写失败的 `杀.test.ts`(harness 还不存在)**

在 `tests/skill-tests/杀.test.ts` 写入:

```ts
// tests/skill-tests/杀.test.ts
// 杀(基本牌)技能测试示范
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function buildState(opts?: { p2Hand?: string[]; extraCardMap?: Record<string, Card> }): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  const dodge: Card = { id: 'c3', name: '闪', suit: '♥', rank: '2', type: '基本牌' };
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['杀'] }),
      makePlayer({ index: 1, name: 'P2', hand: opts?.p2Hand ?? [], skills: ['闪'] }),
    ],
    cardMap: { c1: slash, c3: dodge, ...opts?.extraCardMap },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

function makePlayer(opts: { index: number; name: string; hand: string[]; skills: string[] }) {
  return {
    ...opts, character: '主公', health: 4, maxHealth: 4, alive: true,
    equipment: {}, vars: {}, marks: [], pendingTricks: [], judgeZone: [],
  };
}

describe('杀', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  it('P1 对 P2 出杀,P2 不出闪 → P2 扣 1 血', async () => {
    harness.setup(buildState());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', ['P2']);
    await P2.pass();

    expect(P2.view.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  it('P1 对 P2 出杀,P2 出闪 → 双方不扣血,杀和闪结算完毕进入弃牌堆', async () => {
    harness.setup(buildState({ p2Hand: ['c3'] }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', ['P2']);
    // 中间状态:杀已离开 P1 手牌,正在处理区,等待 P2 出闪
    expect(harness.state.zones.processing).toContain('c1');
    expect(P1.view.players[0].hand).not.toContain('c1');

    await P2.respond('闪', { cardId: 'c3' });
    // 结算完成:杀和闪都已最终落到弃牌堆
    expect(P2.view.players[1].health).toBe(4);
    expect(harness.state.zones.discardPile).toEqual(
      expect.arrayContaining(['c1', 'c3']),
    );
    expect(harness.state.zones.processing).toEqual([]);
  });

  it('同回合不能出第二张杀', async () => {
    const c2: Card = { id: 'c2', name: '杀', suit: '♠', rank: '2', type: '基本牌' };
    harness.setup(buildState({ extraCardMap: { c2 } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', ['P2']);
    await P2.pass();

    await expect(
      P1.useCardAndTarget('杀', 'c2', ['P2']),
    ).rejects.toThrow(/出杀次数已用尽/);
  });
});
```

- [ ] **Step 3.2: 跑测试,验证失败**

```bash
cd /home/zlt/projects/sanguosha && pnpm test:skills
```

Expected: FAIL with "Cannot find module '../engine-harness'" 或类似导入错误

- [ ] **Step 3.3: 实现 `tests/engine-harness.ts`(单文件,所有类)**

创建 `tests/engine-harness.ts`:

```ts
// tests/engine-harness.ts
// 技能集成测试 harness:
//   SkillTestHarness  → 引擎生命周期 + 玩家索引
//   PlayerSession     → 玩家操作/查询/断言
//   FakeFrontendAPI   → 收集 defineAction 声明
//
// 设计原则:
//   - 用玩家术语(pass / respond / useCard),不暴露 timer/pending/atom 机制
//   - 断言可观察游戏状态(health / hand / zone),不断言内部 atom 序列
//   - 不 mock 任何引擎组件:复用真实 createEngine / dispatch / apply pipeline
//   - 走 engine.fireTimeout() 触发 onTimeout(语义最准,不需 fake timers)

import type {
  ActionPrompt,
  Atom,
  Card,
  CardWrapper,
  ClientMessage,
  FrontendAPI,
  GameEvent,
  GameState,
  GameView,
  TargetFilter,
} from '../src/engine/types';
import { createEngine, type EngineInstance } from '../src/engine/create-engine';
import { getEventCount, getEvents } from '../src/engine/event-stream';
import { getSkillModule } from '../src/engine/skill';

// ─── 公开类型 ──────────────────────────────────────────────────

export interface ActionDef {
  skillId: string;
  ownerId: string;
  actionType: string;
  label: string;
  prompt: ActionPrompt;
  transform?: (card: Card) => CardWrapper;
}

// ─── FakeFrontendAPI ───────────────────────────────────────────

export class FakeFrontendAPI implements FrontendAPI {
  viewer: string;
  private actions: ActionDef[] = [];
  private currentSkillId = '';

  constructor(viewer: string) {
    this.viewer = viewer;
  }

  setCurrentSkill(skillId: string): void {
    this.currentSkillId = skillId;
  }

  defineAction(
    actionType: string,
    opts: {
      label: string;
      style?: 'primary' | 'danger' | 'default' | 'passive';
      prompt: ActionPrompt;
      transform?: (card: Card) => CardWrapper;
    },
  ): void {
    this.actions.push({
      skillId: this.currentSkillId,
      ownerId: this.viewer,
      actionType,
      label: opts.label,
      prompt: opts.prompt,
      transform: opts.transform,
    });
  }

  onEvent(_handler: (event: GameEvent, view: GameView) => void): () => void {
    return () => {};
  }

  playEffect(_effect: import('../src/engine/types').AtomEffect): void {
    /* no-op: harness 不渲染 */
  }

  getActions(): ActionDef[] {
    return this.actions;
  }
}

// ─── PlayerSession ─────────────────────────────────────────────

export class PlayerSession {
  readonly playerName: string;
  readonly frontend: FakeFrontendAPI;
  private lastEventIndex = 0;

  constructor(playerName: string, private harness: SkillTestHarness) {
    this.playerName = playerName;
    this.frontend = new FakeFrontendAPI(playerName);
  }

  // ─── 视图与查询 ───────────────────────────────────────────

  get view(): GameView {
    const idx = this.harness.state.players.findIndex((p) => p.name === this.playerName);
    return this.harness.engine.buildView(idx);
  }

  get newEvents(): GameEvent[] {
    const all = getEvents(this.lastEventIndex);
    this.lastEventIndex = getEventCount();
    return all;
  }

  availableActions(): ActionDef[] {
    return this.frontend.getActions();
  }

  /** 根据前端 defineAction 的 cardFilter 找一张合法牌。跑真实 filter 函数。 */
  findValidCard(actionType: string, extra?: (c: Card) => boolean): Card | null {
    const def = this.availableActions().find((a) => a.actionType === actionType);
    if (!def) return null;
    const filter = extractCardFilter(def.prompt);
    if (!filter) return null;
    const self = this.view.players[this.view.viewer];
    for (const cardId of self.hand ?? []) {
      const card = this.view.cardMap[cardId];
      if (!card) continue;
      if (filter(card) && (!extra || extra(card))) return card;
    }
    return null;
  }

  /** 根据前端 defineAction 的 targetFilter 找合法目标。 */
  findValidTargets(actionType: string, count?: number): string[] {
    const def = this.availableActions().find((a) => a.actionType === actionType);
    if (!def) return [];
    const targetFilter = extractTargetFilter(def.prompt);
    if (!targetFilter) return [];
    const result: string[] = [];
    for (const p of this.view.players) {
      if (p.name === this.playerName) continue;
      if (!p.alive) continue;
      if (!targetFilter.filter || targetFilter.filter(this.view, p.name)) {
        result.push(p.name);
        if (count !== undefined && result.length >= count) break;
      }
    }
    return result;
  }

  // ─── 操作 ─────────────────────────────────────────────────

  async useCardAndTarget(
    skillId: string,
    cardId: string,
    targets: string[],
  ): Promise<void> {
    return this.dispatch({ skillId, actionType: 'use', params: { cardId, targets } });
  }

  async useCard(
    skillId: string,
    cardId: string,
    params: Record<string, import('../src/engine/types').Json> = {},
  ): Promise<void> {
    return this.dispatch({ skillId, actionType: 'use', params: { cardId, ...params } });
  }

  async respond(
    skillId: string,
    params: Record<string, import('../src/engine/types').Json> = {},
  ): Promise<void> {
    return this.dispatch({ skillId, actionType: 'respond', params });
  }

  /** 放弃响应当前等待(不出闪、不发动技能、不确认)。走 onTimeout 路径。 */
  async pass(): Promise<void> {
    await this.harness.engine.fireTimeout();
  }

  async triggerAction(
    skillId: string,
    actionType: string,
    params: Record<string, import('../src/engine/types').Json> = {},
  ): Promise<void> {
    return this.dispatch({ skillId, actionType, params });
  }

  // ─── 断言 ─────────────────────────────────────────────────

  /** 断言当前有 pending 等待本玩家。atomType 是玩家术语(如 '询问闪')。 */
  expectPending(atomType: string): void {
    const slot = this.harness.state.pendingSlot;
    if (!slot) throw new Error(`expectPending(${atomType}) 但无 pending`);
    const target = extractPendingTarget(slot.atom);
    expect(slot.atom.type).toBe(atomType);
    expect(target).toBe(this.playerName);
  }

  expectNoPending(): void {
    expect(this.harness.state.pendingSlot).toBeUndefined();
  }

  // ─── 内部 ─────────────────────────────────────────────────

  /** 遍历玩家每个 skill,跑 onMount(若存在)收集 defineAction 声明。 */
  loadFrontend(): void {
    const player = this.harness.state.players.find((p) => p.name === this.playerName)!;
    for (const skillId of player.skills) {
      const mod = getSkillModule(skillId);
      if (!mod.onMount) continue; // 后端 only skill 跳过(合法)
      this.frontend.setCurrentSkill(skillId);
      const skill = mod.createSkill(skillId, this.playerName);
      mod.onMount(skill, this.frontend);
    }
  }

  private async dispatch(
    msg: Omit<ClientMessage, 'ownerId' | 'baseSeq'>,
  ): Promise<void> {
    const result = await this.harness.engine.dispatch({
      ...msg,
      ownerId: this.playerName,
      baseSeq: this.harness.engine.getState().seq,
    });
    if (result.error) throw new Error(`dispatch error: ${result.error}`);
  }
}

// ─── SkillTestHarness ──────────────────────────────────────────

export class SkillTestHarness {
  readonly engine: EngineInstance;
  private sessions = new Map<string, PlayerSession>();

  constructor() {
    this.engine = createEngine();
  }

  /** 初始化:重置引擎 → bootstrap state → 为每个玩家创建 session 并加载 onMount */
  setup(state: GameState): void {
    this.engine.resetForTest();
    this.engine.bootstrap(state);
    this.sessions.clear();
    for (const player of state.players) {
      const session = new PlayerSession(player.name, this);
      session.loadFrontend();
      this.sessions.set(player.name, session);
    }
  }

  player(name: string): PlayerSession {
    const session = this.sessions.get(name);
    if (!session) throw new Error(`Player ${name} not found in harness`);
    return session;
  }

  get state(): GameState {
    return this.engine.getState();
  }

  get events(): GameEvent[] {
    return getEvents(0);
  }
}

// ─── 内部 helper(私有) ────────────────────────────────────────

/** 从 ActionPrompt 中提取 cardFilter(filter 函数 + min/max) */
function extractCardFilter(prompt: ActionPrompt): ((c: Card) => boolean) | null {
  switch (prompt.type) {
    case 'useCard':
    case 'useCardAndTarget':
      return prompt.cardFilter.filter ?? null;
    default:
      return null;
  }
}

/** 从 ActionPrompt 中提取 targetFilter */
function extractTargetFilter(prompt: ActionPrompt): TargetFilter | null {
  switch (prompt.type) {
    case 'selectTarget':
    case 'useCardAndTarget':
      return prompt.targetFilter;
    default:
      return null;
  }
}

/** 从 waiting atom 中提取 target 字段(所有内置等待型 atom 都有 target) */
function extractPendingTarget(atom: Atom): string {
  if ('target' in atom && typeof atom.target === 'string') return atom.target;
  return '';
}
```

- [ ] **Step 3.4: 跑测试,验证通过**

```bash
cd /home/zlt/projects/sanguosha && pnpm test:skills
```

Expected: 3 passed (杀 3 个 case)

- [ ] **Step 3.5: 跑 core 项目,确保没有破坏旧测试**

```bash
cd /home/zlt/projects/sanguosha && pnpm test
```

Expected: 与 Task 2 step 2.4 数量相同的测试通过(略增 1 个新 test file `杀.test.ts` 不在 core 内不影响)

- [ ] **Step 3.6: 提交**

```bash
cd /home/zlt/projects/sanguosha && git add tests/engine-harness.ts tests/skill-tests/杀.test.ts
git commit -m "feat(test): 引擎测试 harness + 杀.test.ts 示范(3 case)"
```

---

## Task 4: 前后端契约验证骨架

**Files:**
- Create: `tests/skill-tests/contract.test.ts`

- [ ] **Step 4.1: 写 `contract.test.ts`**

```ts
// tests/skill-tests/contract.test.ts
// 前后端契约验证(正向):每个 defineAction 声明的 actionType 都有对应 registerAction。
// 反向检查暂不做(等 PR-A:给所有 backend-only skill 补 onMount 之后)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { findActionEntry } from '../../src/engine/skill';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';

function buildStateWithSkills(skillIds: string[]): GameState {
  return createGameState({
    players: [
      {
        index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true,
        hand: [], equipment: {}, skills: skillIds, vars: {}, marks: [], pendingTricks: [], judgeZone: [],
      },
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('前端 → 后端契约', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  // 当前已有 onMount 的 skill(由 grep -l "onMount" src/engine/skills/*.ts 得来)
  const SKILLS_WITH_ONMOUNT = ['武圣', '仁德', '制衡', '激将', '丈八蛇矛'];

  for (const skillId of SKILLS_WITH_ONMOUNT) {
    it(`${skillId}: defineAction 声明的 actionType 都有对应 registerAction`, () => {
      harness.setup(buildStateWithSkills([skillId]));

      const P1 = harness.player('P1');
      const declared = P1.availableActions();
      expect(declared.length).toBeGreaterThan(0);

      for (const def of declared) {
        const found = findActionEntry(def.skillId, def.ownerId, def.actionType);
        expect(
          found,
          `${skillId}.${def.actionType} declared in onMount but not registered in onInit`,
        ).toBeDefined();
      }
    });
  }

  it.skip('TODO: 反向检查 — 每个 registerAction 都应有对应的 defineAction', () => {});
});
```

- [ ] **Step 4.2: 跑测试,验证通过**

```bash
cd /home/zlt/projects/sanguosha && pnpm test:skills
```

Expected: 6 passed (5 个 skill 契约 + 1 个 skip)

- [ ] **Step 4.3: 提交**

```bash
cd /home/zlt/projects/sanguosha && git add tests/skill-tests/contract.test.ts
git commit -m "feat(test): 前后端契约验证骨架(正向 5 个 skill,反向留 TODO)"
```

---

## Task 5: 验收 — 全量测试 + typecheck + lint

**Files:** (本任务无文件改动,只跑命令)

- [ ] **Step 5.1: `pnpm test`(core 项目)全绿**

```bash
cd /home/zlt/projects/sanguosha && pnpm test
```

Expected: 所有现有 core 测试通过 + 1 个新文件 `new-engine-fire-timeout.test.ts` (2 tests) 通过;总通过数比改动前 +2

- [ ] **Step 5.2: `pnpm test:skills`(skills 项目)全绿**

```bash
cd /home/zlt/projects/sanguosha && pnpm test:skills
```

Expected: 杀.test.ts (3) + contract.test.ts (5 passed + 1 skip) = 8 passed

- [ ] **Step 5.3: `pnpm test:all`(两个项目一起)全绿**

```bash
cd /home/zlt/projects/sanguosha && pnpm test:all
```

Expected: core + skills 都通过,无串扰报错

- [ ] **Step 5.4: `pnpm typecheck` 通过**

```bash
cd /home/zlt/projects/sanguosha && pnpm typecheck
```

Expected: 无 TS 错误。常见问题:harness 文件若被 core 项目编译,可能因 `findActionEntry` 导出检查触发 import 错误——若有,确认 `src/engine/skill.ts` 已导出 `findActionEntry`(已确认导出)

- [ ] **Step 5.5: `pnpm lint` 无新错误**

```bash
cd /home/zlt/projects/sanguosha && pnpm lint
```

Expected: 无新增 ESLint 报错。命名规则已在 harness 文件中遵守:工具型抽象文件名(`engine-harness.ts`)、英文类名(`SkillTestHarness` / `PlayerSession` / `FakeFrontendAPI`)、英文函数名(`useCardAndTarget` / `pass` / `respond`)、中文文件名(`杀.test.ts`)

- [ ] **Step 5.6: 隔离稳定性 — 连跑 3 次 `pnpm test:skills`**

```bash
cd /home/zlt/projects/sanguosha && for i in 1 2 3; do pnpm test:skills; done
```

Expected: 3 次都通过,无间歇失败(fork 池隔离生效)

- [ ] **Step 5.7: 提交(如有改动)**

若上述任一步骤发现并修复了问题(应没有),提交修复:

```bash
cd /home/zlt/projects/sanguosha && git status
# 若有改动:git add -A && git commit -m "chore: 验收发现的小问题修复"
```

---

## 风险点回顾(spec §7.3)

| 风险 | 本计划的应对 |
|---|---|
| A. 引擎修改的副作用 | Task 1 step 1.7 显式跑 `pnpm test` 验证 core 行为不变 |
| B. vitest 4 projects 配置陷阱 | Task 2 step 2.4/2.5 验证 `pnpm test` 仍跑 core、`pnpm test:skills` 不报错;Task 5 step 5.3 验证 `test:all` 跑全量 |
| C. fork 隔离启动成本 | Task 5 step 5.6 连跑 3 次验证稳定(50ms/file × 2 文件可接受) |
| D. PendingSlot 私有字段污染契约 | `_fireTimeoutNow` 用 `?` + `_` 前缀 + JSDoc 注释标明"内部钩子"(Task 1 step 1.3) |
| E. 杀没有 onMount | 杀.test.ts 未演示 `findValidCard`(spec §5.1 已记录);P4 补 onMount 时再加 |
| F. contract.test.ts 列表硬编码 | 本计划不做反射遍历(降低首次落地复杂度);后续 PR-B 改反射 |

---

## 后续 PR 路线图(不在本计划范围)

```
本 PR (Task 1-5, P0-P3 基础设施)
  ↓
PR-A: 给所有 backend-only skill 补 onMount        (前置 = 本 PR)
  ↓
PR-B: contract.test.ts 启用反向检查 + 自动遍历     (前置 = PR-A)
  ↓
PR-C: P4 技能逐批迁移                              (前置 = 本 PR;可与 PR-A/B 并行)
  ↓
PR-D: 删除 scenario-runner.ts + legacy scenarios   (前置 = PR-C 全部完成)
```
