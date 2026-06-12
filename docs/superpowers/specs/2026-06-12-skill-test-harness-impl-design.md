# 技能测试方案实现设计(Spec)

> 实现对象:[`docs/design/skill-test-harness.md`](../../design/skill-test-harness.md)
> 本 spec 范围:**Phase 0 + Phase 1 + Phase 2 + Phase 3 + 1 个示范(`tests/skill-tests/杀.test.ts`)**。Phase 4(全量技能迁移)、给现有 backend-only skill 补 `onMount`、删除 legacy scenarios,均不在本次 PR 范围。

## 0. 决策摘要

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| 1 | 实现范围 | P0-P3 + 杀.test.ts 单示范 | 后续 PR 增量迁移其他 40+ 技能 |
| 2 | vitest 配置 | vitest 4 `projects` 数组(写在 `vitest.config.ts` 内) | vitest 4 推荐形式,不再用单独 `vitest.workspace.ts` |
| 3 | pending 超时触发 | 暴露 `engine.fireTimeout()`,harness 提供 `PlayerSession.pass()` | 走引擎真实的 onTimeout 路径,语义最准;harness 不需 fake timers |
| 4 | API 命名 | `pass()` / `respond()` / `useCardAndTarget()` —— 用玩家术语,不暴露 timer/pending 机制名 | 测试代码按游戏规则而非引擎实现写 |
| 5 | 断言原则 | 断言可观察游戏状态(health/hand/zone),不断言内部 atom 序列 | 同上 |

---

## 1. 总体架构

```
SkillTestHarness
├─ engine: EngineInstance          ← createEngine()(本进程唯一)
├─ sessions: Map<name, PlayerSession>
├─ setup(state):
│    engine.resetForTest()         ← 清 skill 实例 + 清事件流
│    engine.bootstrap(state)       ← 跑所有 onInit
│    for each player:
│      session = new PlayerSession(name, harness)
│      session.loadFrontend()      ← 跑每个 skill 的 onMount(skill, fakeAPI)
└─ skipTimeout 通过 engine.fireTimeout() 暴露

PlayerSession
├─ playerName
├─ frontend: FakeFrontendAPI       ← 收集 defineAction 声明
├─ lastEventIndex: number          ← 用于 newEvents 增量读
└─ 操作方法 → 包装 engine.dispatch / engine.fireTimeout

FakeFrontendAPI
├─ viewer: playerName
├─ actions: ActionDef[]
└─ defineAction / onEvent / playEffect   ← onEvent/playEffect 空操作
```

**生命周期** = 每个 vitest test:

```ts
beforeEach(() => {
  harness = new SkillTestHarness();
  harness.setup(buildInitialState());  // resetForTest 在 setup 内部
});
```

**关键设计取舍**:
- 模块级全局状态(skill instance map / event stream / hook map)由 `engine.resetForTest()` 兜底清理——这是引擎已有契约,harness 不重新实现
- `tests/skill-tests/` 走独立 worker(fork)隔离,启动 ~50ms 是可接受的安全边界
- harness 不持有锁、不维护 pending 队列、不重新实现状态机。所有运行时控制都通过 `engine.dispatch` / `engine.fireTimeout` 两个入口完成

---

## 2. vitest 4 projects 配置

### 2.1 `vitest.config.ts`

```ts
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

### 2.2 `package.json` scripts

```json
{
  "scripts": {
    "test":              "vitest run --project core",
    "test:skills":       "vitest run --project skills",
    "test:all":          "vitest run",
    "test:watch":        "vitest --watch --project core",
    "test:skills:watch": "vitest --watch --project skills"
  }
}
```

### 2.3 影响

- `pnpm test` 行为与改动前一致(仍跑 core)
- `pnpm test:skills` 新增,仅跑 `tests/skill-tests/`
- `pnpm test:all` 新增,本地跑全量
- CI 可保留 `pnpm test:all` 或拆成两个 job

---

## 3. 引擎修改点 — `engine.fireTimeout()`

为了 harness 干净触发 onTimeout(走真正的引擎设计语义,而非"等价空回应"hack),引擎暴露新接口。修改 3 个点。

### 3.1 `src/engine/types.ts` — `PendingSlot` 加内部字段

```ts
export interface PendingSlot {
  atom: Atom;
  definition: AtomDefinition;
  startTime: number;
  deadline: number;
  resolve: () => void;
  /** 内部:由 engine-api 在创建 pending 时挂上,供 engine.fireTimeout 立即触发 onTimeout */
  _fireTimeoutNow?: () => Promise<void>;
}
```

> 加 `_` 前缀 + `?:` 表明这是引擎内部钩子,不属于 PendingSlot 对外契约。

### 3.2 `src/engine/engine-api.ts` — 提取 timer callback

当前:

```ts
const timer = setTimeout(async () => {
  if (ctx.state.pendingSlot === slot) {
    ctx.state = { ...ctx.state, pendingSlot: undefined };
    await api.apply(pending.onTimeout);
  }
  safeResolve();
}, timeoutMs);
```

改为:

```ts
const fireTimeoutNow = async () => {
  if (ctx.state.pendingSlot !== slot) return;
  clearTimeout(timer);
  ctx.state = { ...ctx.state, pendingSlot: undefined };
  await api.apply(pending.onTimeout);
  safeResolve();
};
const timer = setTimeout(fireTimeoutNow, timeoutMs);
slot._fireTimeoutNow = fireTimeoutNow;
```

行为不变:原 setTimeout 仍按 timeoutMs 触发同样回调。**新增**:`slot._fireTimeoutNow` 可被外部立即调用,会 `clearTimeout` 防止重复触发。

### 3.3 `src/engine/create-engine.ts` — 暴露 `fireTimeout()`

```ts
export interface EngineInstance {
  dispatch(message: ClientMessage): Promise<DispatchResult>;
  buildView(viewer: number): GameView;
  resetForTest(): void;
  bootstrap(initialState: GameState): GameState;
  rebootstrap(): void;
  getState(): GameState;
  /** 测试用:立即触发当前 pending 的 onTimeout(模拟超时,绕过真实 setTimeout) */
  fireTimeout(): Promise<DispatchResult>;
}

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

### 3.4 改动边界

- 不破坏现有 dispatch 行为——timer 仍按 timeoutMs 正常 fire
- 不破坏 PendingSlot 对外契约——`_fireTimeoutNow` 是 `?:` 可选私有字段
- 非测试路径(真实 server session)永远不会调用 `fireTimeout()`
- 命名 `fireTimeout` 而非 `skipTimeout`:明确语义是"立即触发 onTimeout atom",而不是"跳过 pending"

---

## 4. PlayerSession API 表面

### 4.1 操作组

```ts
class PlayerSession {
  /** 主动出牌+目标 */
  async useCardAndTarget(skillId, cardId, targets): Promise<void>;

  /** 主动出牌(无目标) */
  async useCard(skillId, cardId, params?): Promise<void>;

  /** 响应当前等待(出闪、出杀响应、确认、分配等) */
  async respond(skillId, params?): Promise<void>;

  /** 放弃响应当前等待(语义:不出闪、不发动技能、不确认)。内部走 onTimeout 路径。 */
  async pass(): Promise<void>;

  async triggerAction(skillId, actionType, params?): Promise<void>;
}
```

**统一内部实现**(消除重复):

```ts
private async dispatch(msg: Omit<ClientMessage, 'ownerId' | 'baseSeq'>) {
  const result = await this.harness.engine.dispatch({
    ...msg,
    ownerId: this.playerName,
    baseSeq: this.harness.engine.getState().seq,
  });
  if (result.error) throw new Error(`dispatch error: ${result.error}`);
}

async useCardAndTarget(skillId, cardId, targets) {
  return this.dispatch({ skillId, actionType: 'use', params: { cardId, targets } });
}
async respond(skillId, params = {}) {
  return this.dispatch({ skillId, actionType: 'respond', params });
}
async pass() {
  await this.harness.engine.fireTimeout();
}
```

> baseSeq 由 `dispatch()` 私有方法自动填充,测试代码永远不感知 seq。

### 4.2 查询组

```ts
class PlayerSession {
  get view(): GameView {
    const idx = this.harness.state.players.findIndex(p => p.name === this.playerName);
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

  findValidCard(actionType: string, extra?: (c: Card) => boolean): Card | null {
    const def = this.availableActions().find(a => a.actionType === actionType);
    if (!def) return null;
    const filter = extractCardFilter(def.prompt);
    if (!filter) return null;
    const self = this.view.players[this.view.viewer];
    for (const cardId of self.hand) {
      const card = this.view.cardMap[cardId];
      if (!card) continue;
      if (filter(card) && (!extra || extra(card))) return card;
    }
    return null;
  }

  findValidTargets(actionType: string, count?: number): string[];
}
```

### 4.3 断言组

```ts
class PlayerSession {
  /** 当前是否轮到这个玩家响应某种等待(atom type 既是引擎机制名也是玩家术语,如"询问闪") */
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
}
```

**去掉的 API**(避免泄露实现):
- `expectAtoms` / `expectExactAtoms` / `expectAtomsContain`(强耦合内部 atom 序列;若后续某个技能测试确实需要锁定 hook 触发链路,再单独引入)
- `skipTimeout`(改名为 `pass`,玩家术语)

### 4.4 `FakeFrontendAPI`

```ts
class FakeFrontendAPI implements FrontendAPI {
  viewer: string;
  private actions: ActionDef[] = [];
  private currentSkillId = '';

  setCurrentSkill(skillId: string) { this.currentSkillId = skillId; }

  defineAction(actionType, opts) {
    this.actions.push({
      skillId: this.currentSkillId,
      ownerId: this.viewer,
      actionType,
      label: opts.label,
      prompt: opts.prompt,
      transform: opts.transform,
    });
  }

  onEvent(_handler): () => void { return () => {}; }
  playEffect(_effect): void { /* no-op */ }

  getActions(): ActionDef[] { return this.actions; }
}

// session.loadFrontend():
loadFrontend() {
  const state = this.harness.state;
  const player = state.players.find(p => p.name === this.playerName)!;
  for (const skillId of player.skills) {
    const mod = getSkillModule(skillId);
    if (!mod.onMount) continue;     // 后端 only skill 跳过(合法情况)
    this.frontend.setCurrentSkill(skillId);
    const skill = mod.createSkill(skillId, this.playerName);
    mod.onMount(skill, this.frontend);
  }
}
```

---

## 5. `tests/skill-tests/杀.test.ts` 示范测试

```ts
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

**关键演示点**:
- 测试代码全程没出现 `baseSeq`
- `pass()` 替代 `skipTimeout()`(玩家术语)
- 断言只有游戏可观察事实(health / zone / throw),没有 atom 序列
- 显示了"中间处理区状态"和"最终弃牌堆状态"两种断言时机

### 5.1 关于 `杀.ts` 无 `onMount`

杀目前没声明 `onMount`,所以 `findValidCard('use')` 在杀.test.ts 里无法演示。filter 一致性测试需要等 `杀.ts` 补 `onMount` 后再加(后续 PR)。

### 5.2 关于发现的 `闪.ts` 实现 bug

`src/engine/skills/闪.ts:21-26` 中,闪直接从手牌进弃牌堆,跳过处理区,违反游戏规则。**这不属于本次 PR 范围**——单独 PR 修。本次的杀.test.ts case 2 中间状态断言只检查杀(在处理区),不检查闪,因此不会触发这个 bug。

---

## 6. 文件布局

### 6.1 文件清单

**新增**(4 个):

```
tests/engine-harness.ts                       ← SkillTestHarness + PlayerSession + FakeFrontendAPI + ActionDef
tests/integration/new-engine-fire-timeout.test.ts ← engine.fireTimeout() 单元测试(归 core 项目)
tests/skill-tests/杀.test.ts                   ← 示范测试(3 个 case)
tests/skill-tests/contract.test.ts            ← 契约验证最小骨架
```

**修改**(5 个):

```
src/engine/types.ts          ← PendingSlot 加 _fireTimeoutNow?: () => Promise<void>
src/engine/engine-api.ts     ← 提取 fireTimeoutNow 函数,挂到 slot
src/engine/create-engine.ts  ← EngineInstance 加 fireTimeout(),返回类型
vitest.config.ts             ← 改为 vitest 4 projects 风格(core + skills)
package.json                 ← 新增 test:skills / test:all / test:skills:watch
```

**不动**:

```
tests/integration/new-engine-kill.test.ts   ← 保留(回归保护;后续 PR 删)
tests/integration/new-engine-rende.test.ts
tests/integration/new-engine-hujia.test.ts
tests/scenarios/**                          ← 全部 legacy
tests/scenario-runner.ts
tests/engine-helpers.ts
tests/setup.ts
```

> 共存策略:`tests/integration/new-engine-kill.test.ts` 与 `tests/skill-tests/杀.test.ts` 同时存在一段时间。core 跑前者保证旧风格回归;skills 跑后者验证 harness。两份都 pass 后,后续 PR 删除前者。

### 6.2 `tests/engine-harness.ts` 模块结构

```ts
// ─── 公开类型 ──────────────────────────────────────
export interface ActionDef { skillId; ownerId; actionType; label; prompt; transform? }

// ─── 公开类 ────────────────────────────────────────
export class SkillTestHarness { ... }
export class PlayerSession { ... }
export class FakeFrontendAPI implements FrontendAPI { ... }

// ─── 内部 helper(私有) ──────────────────────────
function extractPendingTarget(atom: Atom): string { ... }
function extractCardFilter(prompt: ActionPrompt): ((c: Card) => boolean) | null { ... }
function extractTargetFilter(prompt: ActionPrompt): TargetFilter | null { ... }
```

单文件,~200 行。所有 P0-P3 范围 API 集中于此。

### 6.3 `tests/skill-tests/contract.test.ts` 骨架

**设计原则**:契约验证有两个方向。本次只做正向(宽松),反向留给后续 PR。

| 方向 | 检查 | 本次实现 |
|---|---|---|
| 正向 | 每个 `defineAction` 都有对应 `registerAction` | ✅ 本次 |
| 反向 | 每个 `registerAction` 都有对应 `defineAction` | ❌ 后续(大多数 skill 现尚未补 onMount,反向会大面积红) |

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { findActionEntry } from '../../src/engine/skill';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';

describe('前端 → 后端契约', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  const SKILLS_WITH_ONMOUNT = ['武圣', '仁德', '制衡', '激将', '丈八蛇矛'];

  for (const skillId of SKILLS_WITH_ONMOUNT) {
    it(`${skillId}: defineAction 声明的 actionType 都有对应 registerAction`, () => {
      harness.setup(createGameState({
        players: [
          makePlayer({ index: 0, name: 'P1', skills: [skillId] }),
        ],
        cardMap: {},
      }));

      const P1 = harness.player('P1');
      const declared = P1.availableActions();
      expect(declared.length).toBeGreaterThan(0);

      for (const def of declared) {
        const found = findActionEntry(def.skillId, def.ownerId, def.actionType);
        expect(found, `${skillId}.${def.actionType} declared in onMount but not registered in onInit`).toBeDefined();
      }
    });
  }

  it.skip('TODO: 每个 registerAction 都应有对应的 defineAction', () => {});
});
```

**两个目的**:
1. 立契约验证框架,后续 PR 在此扩充
2. 验证 harness 的 `availableActions()` / `loadFrontend()` 能正确收集 5 个已有 onMount 的 skill 的声明

### 6.4 `tests/integration/new-engine-fire-timeout.test.ts` 内容

归 **core** 项目(不进 skill-tests/),验证 `engine.fireTimeout()` 接口本身,不依赖 harness:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createEngine, type EngineInstance } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
// ...(类似 new-engine-kill.test.ts 的 buildInitialState)

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
    await engine.dispatch({ skillId: '杀', actionType: 'use', ownerId: 'P1', params: { cardId: 'c1', targets: ['P2'] }, baseSeq: 0 });
    expect(engine.getState().pendingSlot).toBeDefined();

    await engine.fireTimeout();
    expect(engine.getState().pendingSlot).toBeUndefined();
    const p2 = engine.getState().players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
  });
});
```

### 6.5 命名规则(CLAUDE.md 第 5 节)

- `tests/engine-harness.ts` — 工具型抽象,英文文件名 ✅
- `tests/skill-tests/杀.test.ts` — 业务概念(技能名),中文文件名 ✅
- `tests/skill-tests/contract.test.ts` — 工具型断言集合,英文文件名 ✅
- 类名 `SkillTestHarness` / `PlayerSession` / `FakeFrontendAPI` — 工具型抽象类,英文 ✅

---

## 7. 验收标准 + 不做的事 + 风险点

### 7.1 验收标准

| # | 验收项 | 验证方式 |
|---|---|---|
| 1 | `pnpm test` 行为与改动前一致 | core 项目运行,通过测试数量/覆盖范围与改动前相同 |
| 2 | `pnpm test:skills` 仅运行 `tests/skill-tests/**` | 输出仅含 `杀.test.ts` + `contract.test.ts` 的 case |
| 3 | `pnpm test:all` 跑两个 project,全绿 | 两个 project 输出都通过 |
| 4 | `pnpm typecheck` 通过 | TS 编译无错误 |
| 5 | `pnpm lint` 通过 | ESLint 无新错误(harness 文件遵循项目命名规则) |
| 6 | `engine.fireTimeout()` 可独立调用 | `tests/integration/new-engine-fire-timeout.test.ts`:无 pending 时返回当前 state 不抛错;有 pending 时触发 onTimeout 后 pending 清空 |
| 7 | 杀.test.ts 3 个 case 全过 | use+pass / use+respond+处理区中间状态 / limit 拒绝 |
| 8 | contract.test.ts 5 个 skill 都过正向检查 | 武圣/仁德/制衡/激将/丈八蛇矛 都能列出 actionDef 且 actionType 在 registerAction 中找到 |
| 9 | 测试隔离生效 | skills project 用 forks 模式,多次连跑 `pnpm test:skills` 结果稳定 |
| 10 | 旧 `tests/integration/new-engine-kill.test.ts` 仍通过 | 共存策略生效,新旧测试都绿 |

### 7.2 不做的事

- ❌ 不删 `tests/integration/new-engine-kill.test.ts`(共存,后续 PR 删)
- ❌ 不删 `tests/scenarios/**`(留给 P4 逐个迁移)
- ❌ 不删 `tests/scenario-runner.ts` / `tests/engine-helpers.ts`
- ❌ 不迁移其他技能测试(只迁移杀,作为示范)
- ❌ 不为现有 backend-only skill(杀/闪/桃/无中生有/八卦阵/遗计 等)补 `onMount`(P4 的事)
- ❌ 不实现 `getPlayerEvents()` per-player 视图分叉(设计文档 §6.5 留作 future)
- ❌ 不修闪缺失的"处理区"流程(发现的 bug 单独 PR 修)
- ❌ 不引入 fake timers(通过 `pass` / `fireTimeout` 完全覆盖)
- ❌ 不 mock 任何引擎组件(harness 复用真实 createEngine / dispatch / apply pipeline)
- ❌ 不引入新依赖

### 7.3 已知风险点 + 应对

| 风险 | 应对 |
|---|---|
| **A. 引擎修改的副作用**:`engine-api.ts` 改 timer callback 提取,理论上行为不变但需验证 | 跑 core 项目全量(`pnpm test`)+ `tests/integration/new-engine-kill.test.ts` 验证 |
| **B. vitest 4 projects 配置陷阱**:`extends: true` 在 v4 是新形式,配置错可能两个 project 实际跑同样测试 | 验收项 #1 / #2 / #3 同时验证三种命令的实际产出 |
| **C. fork 隔离启动成本**:每个 skill-test 文件独立 fork ~50ms。本次仅 2 个文件,~100ms,可接受。P4 全量(40+ 文件)累积 2-3s 时需要监控 | 本次不优化,P4 时若出问题再考虑改 threads 池 + 严格 resetForTest |
| **D. PendingSlot 私有字段污染契约**:`_fireTimeoutNow` 暴露在公开类型里 | 用 `?` + `_` 前缀 + 注释说明"内部钩子,不属于对外契约";后续如有更优封装可调整 |
| **E. 杀没有 onMount**:杀.test.ts 无法演示 `findValidCard` / `findValidTargets` | 文档说明此情况,P4 补 onMount 时再加 filter 一致性测试 |
| **F. contract.test.ts 列表硬编码**:`SKILLS_WITH_ONMOUNT` 是静态数组 | 后续 PR 改用反射(遍历 modules registry,检测哪些有 onMount)。本次不做,降低首次落地复杂度 |

### 7.4 后续 PR 的依赖关系(只是路线图,不在本次 PR 范围)

```
本 PR (P0-P3 基础设施)
  ↓
PR-A: 给所有 backend-only skill 补 onMount        (前置 = 本 PR)
  ↓
PR-B: contract.test.ts 启用反向检查 + 自动遍历     (前置 = PR-A)
  ↓
PR-C: P4 技能逐批迁移                              (前置 = 本 PR;可与 PR-A/B 并行)
  ↓
PR-D: 删除 scenario-runner.ts + legacy scenarios   (前置 = PR-C 全部完成)
```
