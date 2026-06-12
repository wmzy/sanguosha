# 技能测试方案设计

> 本文档定义基于新引擎（ENGINE-DESIGN）的技能集成测试方案。
> 核心思路：用 `createEngine` 真实后端 + `onMount` 虚拟前端 + 事件流桥接，
> 通过多玩家视角模拟完整操作链路，无需 DOM。

---

## 一、问题

### 1.1 现有测试的缺陷

项目现有三种测试模式，各有局限：

| 模式 | 代表文件 | 问题 |
|---|---|---|
| `ScenarioBuilder`（旧） | `tests/scenarios/蜀/武圣.test.ts` | 直接 mutate `GameState`，绕过 `dispatch`，不测 action 路由和 pending 机制 |
| `createEngine` + `dispatch`（新） | `tests/integration/new-engine-kill.test.ts` | 走真实后端，但手动拼 `baseSeq`，无"玩家视角"抽象，前端声明（`defineAction`）完全未被测试 |
| 单元测试 | `tests/unit/skill-hook.test.ts` | 只测钩子注册/调用，不测完整技能链路 |

**关键缺失**：`onMount` 里的 `defineAction` 声明（`ActionPrompt` + `cardFilter`/`targetFilter`）从未在测试中被执行。这意味着：

1. 前端 `cardFilter.filter` 允许的牌 ≠ 后端 `validate` 接受的牌，没人知道
2. 武圣的 `transform` 函数从未被验证
3. `ActionPrompt` 类型和 pending atom 的 `prompt` 对齐关系无法检查

### 1.2 为什么不直接写 E2E

`tests/e2e/` 是真实前后端联调，需要 WebSocket 服务器、浏览器、多标签页。它验证的是网络通信和 UI 渲染，不是技能逻辑正确性。技能测试需要：

- 快速执行（毫秒级，不等动画和网络）
- 精确控制（指定牌堆顺序、手牌、装备）
- 事件流断言（检查 atom 序列，而非 DOM 状态）
- 多玩家视角（P1 看到 X，P2 看到 Y）

### 1.3 为什么需要"虚拟前端"

设计文档（ENGINE-DESIGN §4.1）规定了前后端严格隔离：

```
前端 onMount → defineAction (声明式)
后端 onInit  → registerAction + hooks (逻辑)
```

**契约是 `ClientMessage` + `GameEvent` + `GameView`。** 但技能前端代码（`cardFilter`、`targetFilter`、`transform`）包含真正的业务逻辑——它们决定"哪些牌可以选"、"哪些目标合法"。跳过它们直接构造 `params`，就漏测了前后端一致性问题。

---

## 二、方案概述

### 2.1 架构

```
                    SkillTestHarness
                    ┌──────────────────────────────────────┐
                    │                                      │
  PlayerSession(P1) │          createEngine()              │
  ┌──────────────┐  │          ┌──────────┐                │
  │ FakeFrontend │  │          │ Backend  │                │
  │   API        │──│──event──→│ Engine   │──│              │
  │              │  │  stream  │          │  │              │
  │ onMount()    │  │          │ onInit() │  │              │
  │ defineAction │  │          │ hooks    │  │              │
  │ collection   │  │          └──────────┘  │              │
  └──────────────┘  │               ↑       │              │
                    │          dispatch()    │              │
  PlayerSession(P2) │               │       │              │
  ┌──────────────┐  │               │       │              │
  │ FakeFrontend │  │               │       │              │
  │   API        │  │               │       │              │
  │ onMount()    │  │               │       │              │
  │ defineAction │  │               │       │              │
  └──────────────┘  └──────────────────────────────────────┘
```

三个组件：

1. **真实后端引擎**：`createEngine()` + `dispatch()` + `apply()` pipeline，跑完整 `onInit` 钩子链
2. **虚拟前端**：`FakeFrontendAPI`，真实调用 `onMount`，收集 `defineAction` 声明，执行 filter/transform
3. **事件流桥接**：`getEvents()` 提供 `GameEvent[]`，harness 分发给各玩家 session

### 2.2 测试分层

| 层级 | 测什么 | 工具 | 何时用 |
|---|---|---|---|
| **Layer 1: Harness 集成** | 技能完整链路（选牌→选目标→dispatch→hooks→state→events） | `SkillTestHarness` | 所有技能的 happy path + 边界 |
| **Layer 2: 前端契约** | `defineAction` 声明与 `registerAction` 的一致性 | harness + `availableActions()` | 技能迁移/新增时 |
| **Layer 3: E2E** | WebSocket 通信 + UI 渲染 | `tests/e2e/` | 冒烟，低频 |

### 2.3 测试分区与独立运行

技能数量大（40+），每个技能的测试涉及完整引擎初始化和全局状态注册。如果所有技能测试与核心引擎测试混在一起：

1. **拖慢开发循环**：改引擎代码时 `vitest` 跑全部测试，技能测试的体量和启动开销拖慢反馈
2. **全局状态污染风险**：`registerSkillModule`、`registerActionEntry`、`beforeHooks`/`afterHooks` 都是模块级 Map，技能测试间的隔离靠 `resetForTest()` 清理，任何遗漏都导致串扰
3. **CI 独立调度**：技能测试可以单独跑、单独报错、单独重试，不影响核心 PR 的合并判断

**方案：vitest workspace 分区**。

```
vitest.workspace.ts
├── core    ← vitest.config.ts（现有配置）
│   include: tests/**/*.test.{ts,tsx}
│   exclude: tests/skill-tests/**
│
└── skills  ← vitest.config.skill-tests.ts
    include: tests/skill-tests/**/*.test.ts
    isolation: true   ← 每个 test file 独立 worker（隔离全局状态）
```

对应 npm scripts：

```json
{
  "test": "vitest run --project core",
  "test:skills": "vitest run --project skills",
  "test:all": "vitest run",
  "test:watch": "vitest --watch --project core"
}
```

核心开发时 `npm test` 只跑 `core` 项目（引擎+服务端+客户端），不触发技能测试。
技能开发/迁移时 `npm run test:skills` 只跑技能测试。
CI 中两个项目都跑，失败独立报告。

---

## 三、API 设计

### 3.1 `SkillTestHarness`

主入口，管理引擎生命周期和玩家会话。

```ts
class SkillTestHarness {
  readonly engine: EngineInstance;

  /** 初始化：重置引擎 → bootstrap state → 为每个玩家创建 session 并加载 onMount */
  setup(state: GameState): void;

  /** 获取玩家会话 */
  player(name: string): PlayerSession;

  /** 当前 GameState（只读） */
  get state(): GameState;

  /** 全局事件流（从引擎启动至今的全部 GameEvent） */
  get events(): GameEvent[];

  /** 断言最终状态 */
  assertState(fn: (state: GameState) => void): void;
}
```

**生命周期**：

```ts
const harness = new SkillTestHarness();
harness.setup(createGameState({...}));

// 测试操作...

// 每个 test 自动 cleanup（vitest beforeEach 中 new 即可，resetForTest 在 setup 内部调用）
```

### 3.2 `PlayerSession`

每个玩家一个实例，提供视角隔离的操作和查询 API。

```ts
class PlayerSession {
  readonly playerName: string;

  // ─── 视图 ─────────────────────────────────────

  /** 当前玩家的 GameView（通过 buildView 构建） */
  get view(): GameView;

  /** 自上次 dispatch 以来的新事件 */
  get newEvents(): GameEvent[];

  /** 获取 defineAction 收集到的 action 声明列表 */
  availableActions(): ActionDef[];

  // ─── 操作 ─────────────────────────────────────

  /** 使用牌+目标（杀、南蛮入侵等）—— 自动填充 baseSeq */
  async useCardAndTarget(
    skillId: string,
    cardId: string,
    targets: string[],
  ): Promise<void>;

  /** 使用牌（桃、无中生有等无目标牌） */
  async useCard(skillId: string, cardId: string): Promise<void>;

  /** 回应（出闪、出杀响应等） */
  async respond(skillId: string, params?: Record<string, Json>): Promise<void>;

  /** 确认/取消（八卦阵、遗计确认等） */
  async confirm(choice: boolean): Promise<void>;

  /** 分配（遗计分配牌） */
  async distribute(
    skillId: string,
    allocation: Array<{ target: string; cardIds: string[] }>,
  ): Promise<void>;

  /** 通用技能触发 */
  async triggerAction(
    skillId: string,
    actionType: string,
    params?: Record<string, Json>,
  ): Promise<void>;

  // ─── 辅助选择 ─────────────────────────────────

  /**
   * 根据前端 defineAction 的 cardFilter 找到合法牌。
   * 跑真实的 filter 函数。返回第一张匹配的牌，或 null。
   */
  findValidCard(actionType: string, extraFilter?: (card: Card) => boolean): Card | null;

  /**
   * 根据前端 defineAction 的 targetFilter 找到合法目标。
   * 跑真实的 filter 函数。
   */
  findValidTargets(actionType: string, count?: number): string[];

  // ─── 断言 ─────────────────────────────────────

  /** 断言事件流中包含指定 atom 类型（子序列匹配，忽略 notify 事件） */
  expectAtoms(...types: string[]): void;

  /** 断言事件流的 atom 类型严格匹配 */
  expectExactAtoms(...types: string[]): void;

  /** 断言当前有 pending 等待指定玩家 */
  expectPending(atomType: string): void;

  /** 断言当前无 pending */
  expectNoPending(): void;
}
```

### 3.3 `ActionDef`

`defineAction` 收集到的声明，用于前端契约验证。

```ts
interface ActionDef {
  skillId: string;
  ownerId: string;
  actionType: string;
  label: string;
  prompt: ActionPrompt;
  transform?: (card: Card) => CardWrapper;
}
```

### 3.4 `FakeFrontendAPI`

实现 `FrontendAPI` 接口，收集 `defineAction` 声明。

```ts
class FakeFrontendAPI implements FrontendAPI {
  viewer: string;
  private actions: ActionDef[] = [];

  defineAction(actionType: string, opts: {
    label: string;
    style?: string;
    prompt: ActionPrompt;
    transform?: (card: Card) => CardWrapper;
  }): void {
    this.actions.push({
      skillId: '',  // 调用时由 PlayerSession 补上
      ownerId: this.viewer,
      actionType,
      label: opts.label,
      prompt: opts.prompt,
      transform: opts.transform,
    });
  }

  onEvent(): () => void { return () => {}; }  // harness 直接用 getEvents
  playEffect(): void { /* no-op */ }

  getActions(): ActionDef[] { return this.actions; }
}
```

**为什么不 mock**：`FakeFrontendAPI` 不是 mock——它真实实现了 `FrontendAPI` 接口，与 `onMount` 交互的是真实的技能前端代码。区别只是"渲染"部分（`playEffect`/`onEvent`）空操作。

---

## 四、核心流程

### 4.1 初始化

```
harness.setup(state)
  │
  ├── engine.resetForTest()         // 清理全局注册表 + 事件流
  ├── engine.bootstrap(state)       // 初始化 state + 调用所有玩家的 onInit
  │
  └── for each player:
        └── new PlayerSession(name, harness)
              └── loadFrontendSkills()
                    └── for each skillId in player.skills:
                          └── getSkillModule(skillId).onMount(skill, fakeFrontendAPI)
                                // 收集 defineAction 声明到 actionDefs[]
```

### 4.2 操作流程（以出杀为例）

```
P1.useCardAndTarget('杀', 'c1', ['P2'])
  │
  ├── engine.dispatch({ skillId: '杀', actionType: 'use',
  │                      ownerId: 'P1', params: { cardId: 'c1', targets: ['P2'] },
  │                      baseSeq: state.seq })      // 自动填充
  │   │
  │   ├── validate(view, params)                    // 后端校验
  │   ├── execute(api):                             // 杀.onInit 注册的 execute
  │   │     api.pushFrame('杀', 'P1', { cardId, targets })
  │   │     api.apply({ type: '移动牌', ... })      // 牌入处理区
  │   │     api.apply({ type: '指定目标', ... })    // 选目标
  │   │     api.apply({ type: '询问闪', target: 'P2', source: 'P1' })
  │   │       │
  │   │       ├── before hooks: 八卦阵判定等
  │   │       ├── validate + apply
  │   │       └── 进入 pending 区 → dispatch 返回
  │   │
  │   └── return { state }                          // seq 已递增
  │
  └── 更新 lastEventIndex → newEvents 包含新产生的 atom 事件
```

```
P2.respond('闪', { cardId: 'c3' })
  │
  ├── engine.dispatch({ skillId: '闪', actionType: 'respond',
  │                      ownerId: 'P2', params: { cardId: 'c3' },
  │                      baseSeq: state.seq })
  │   │
  │   ├── 检测 pendingSlot 存在 → 回应路径
  │   ├── 闪.execute(api): api.apply({ type: '移动牌', c3 → 弃牌堆 })
  │   ├── consume pending → 原始杀.execute 恢复
  │   ├── 杀.execute 继续: 检查弃牌堆增量 → 闪避 → 不扣血
  │   └── return { state }
  │
  └── 更新 lastEventIndex
```

### 4.3 事件流断言

```ts
// 子序列匹配——忽略通知事件和无关 atom
P1.expectAtoms('移动牌', '指定目标', '询问闪');
// 等价于：事件流中按顺序出现了这三个 atom type，中间允许有其他事件

// 严格匹配——事件流的 atom 序列必须精确
P1.expectExactAtoms('移动牌', '指定目标', '询问闪', '移动牌', '增量变量');
```

### 4.4 Pending 处理

pending 是测试的核心难点——引擎在等待型 atom 处挂起，需要特定玩家的回应才能继续。

**路径 1：玩家回应**

```ts
await P1.useCardAndTarget('杀', 'c1', ['P2']);  // 进 pending
P2.expectPending('询问闪');
await P2.respond('闪', { cardId: 'c3' });        // 消费 pending → 引擎继续
```

**路径 2：超时（跳过）**

```ts
await P1.useCardAndTarget('杀', 'c1', ['P2']);  // 进 pending
// 不回应 → pending.onTimeout 的 atom 被执行
// 在测试中：直接不做任何操作，引擎的 setTimeout 会触发 onTimeout
// 但测试环境需要用 vi.useFakeTimers() + vi.advanceTimersByTime()
```

**路径 3：嵌套等待（八卦阵 before hook 插入请求回应）**

```ts
await P1.useCardAndTarget('杀', 'c1', ['P2']);  // 进询问闪
// 八卦阵 before hook 内部自动 apply(判定) + apply(请求回应-是否发动八卦阵)
// 这是嵌套等待——内层请求回应先进 pending，被消费后外层询问闪继续进 pending
await P2.confirm(true);                          // 发动八卦阵
// 判定结果决定是否 autoDodge
// 询问闪继续进 pending → 等 P2 出闪或超时
```

---

## 五、测试示例

### 5.1 基本出杀（无回应）

```ts
describe('杀 — 无回应扣血', () => {
  const harness = new SkillTestHarness();

  beforeEach(() => {
    harness.setup(createGameState({
      players: [
        { ..., name: 'P1', hand: ['c1'], skills: ['杀'] },
        { ..., name: 'P2', hand: [], skills: [] },
      ],
      cardMap: { c1: { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' } },
      currentPlayerIndex: 0, phase: '出牌',
    }));
  });

  it('P1 出杀 → P2 不出闪 → 扣 1 血', async () => {
    await harness.player('P1').useCardAndTarget('杀', 'c1', ['P2']);

    harness.player('P1').expectAtoms('移动牌', '指定目标', '询问闪');
    harness.player('P2').expectPending('询问闪');

    // 不回应，等超时 → onTimeout=无操作 → 继续结算
    // 使用 fake timers 加速
    vi.useFakeTimers();
    vi.advanceTimersByTime(15000); // 询问闪 timeout
    vi.useRealTimers();

    harness.assertState(s => {
      expect(s.players[1].health).toBe(3);
      expect(s.zones.discardPile).toContain('c1');
    });
  });
});
```

### 5.2 出杀 + 出闪

```ts
it('P1 出杀 → P2 出闪 → 不扣血', async () => {
  // setup: P2 手牌有闪
  await harness.player('P1').useCardAndTarget('杀', 'c1', ['P2']);

  harness.player('P2').expectPending('询问闪');
  await harness.player('P2').respond('闪', { cardId: 'c3' });

  harness.assertState(s => {
    expect(s.players[1].health).toBe(4);
    expect(s.zones.discardPile).toContain('c1'); // 杀入弃牌堆
    expect(s.zones.discardPile).toContain('c3'); // 闪入弃牌堆
  });
});
```

### 5.3 八卦阵（嵌套等待 + 钩子）

```ts
describe('八卦阵', () => {
  const harness = new SkillTestHarness();

  beforeEach(() => {
    harness.setup(createGameState({
      players: [
        { ..., name: 'P1', hand: ['c1'], skills: ['杀'] },
        { ..., name: 'P2', hand: [], equipment: { 防具: 'armor1' }, skills: ['八卦阵'] },
      ],
      // 牌堆顶放红牌 → 判定成功
      zones: { deck: ['judge1'], ... },
      cardMap: {
        c1: { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' },
        judge1: { id: 'judge1', name: '桃', suit: '♥', rank: '3', type: '基本牌' },
      },
    }));
  });

  it('八卦阵判定红色 → 免伤', async () => {
    await harness.player('P1').useCardAndTarget('杀', 'c1', ['P2']);

    // 八卦阵 before hook 自动触发：判定 → 红色 → 加标签
    harness.player('P1').expectAtoms('移动牌', '指定目标', '判定', '加标签', '询问闪');

    // 询问闪仍在 pending（不 drop），P2 不出闪
    harness.player('P2').expectPending('询问闪');

    // 超时后 autoDodge 生效 → 不扣血
    vi.useFakeTimers();
    vi.advanceTimersByTime(15000);
    vi.useRealTimers();

    harness.assertState(s => {
      expect(s.players[1].health).toBe(4);
    });
  });
});
```

### 5.4 遗计（多步交互：确认 → 摸牌 → 分配）

```ts
describe('遗计', () => {
  const harness = new SkillTestHarness();

  beforeEach(() => {
    harness.setup(createGameState({
      players: [
        { ..., name: 'P1', hand: ['c1'], skills: ['杀'] },
        { ..., name: 'P2', character: '郭嘉', hand: [], skills: ['遗计'] },
        { ..., name: 'P3', hand: [], skills: [] },
      ],
      // 牌堆有牌让遗计摸
      zones: { deck: ['c10', 'c11', 'c20', 'c21'], ... },
      cardMap: { c1: slash, c10: ..., c11: ..., c20: ..., c21: ... },
    }));
  });

  it('郭嘉受伤 → 确认遗计 → 摸牌 → 分配', async () => {
    // 1. 出杀
    await harness.player('P1').useCardAndTarget('杀', 'c1', ['P2']);
    // P2 不出闪
    // ...超时...

    // 2. 遗计 after hook: 请求回应(是否发动)
    harness.player('P2').expectPending('请求回应');
    await harness.player('P2').confirm(true);

    // 3. 摸两张牌
    harness.player('P2').expectAtoms('摸牌');

    // 4. 请求回应(分配牌)
    harness.player('P2').expectPending('请求回应');
    await harness.player('P2').distribute('遗计', [
      { target: 'P3', cardIds: ['c10'] },
      { target: 'P1', cardIds: ['c11'] },
    ]);

    // 5. 验证分配结果
    harness.assertState(s => {
      expect(s.players.find(p => p.name === 'P3')!.hand).toContain('c10');
      expect(s.players.find(p => p.name === 'P1')!.hand).toContain('c11');
    });
  });
});
```

### 5.5 武圣（牌转化 + filter 验证）

```ts
describe('武圣', () => {
  const harness = new SkillTestHarness();

  beforeEach(() => {
    harness.setup(createGameState({
      players: [
        { ..., name: 'P1', hand: ['c1'], skills: ['杀'] },
        { ..., name: 'P2', character: '关羽', hand: ['c2'], skills: ['武圣', '杀'] },
      ],
      cardMap: {
        c1: { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' },
        c2: { id: 'c2', name: '闪', suit: '♥', rank: '7', type: '基本牌' }, // 红色闪
      },
    }));
  });

  it('前端 cardFilter 只允许红色牌', () => {
    const p2 = harness.player('P2');
    const card = p2.findValidCard('transform');
    expect(card).toBeDefined();
    expect(card!.suit).toMatch(/♥|♦/);
  });

  it('红色闪当杀使用', async () => {
    await harness.player('P2').triggerAction('武圣', 'transform', {
      cardId: 'c2',
      targets: ['P1'],
    });
    // 武圣包装 + 标准杀流程
    harness.player('P2').expectAtoms('武圣包装', '移动牌', '指定目标', '询问闪');
  });

  it('黑色牌不通过 filter', () => {
    // 修改牌为黑色
    const state = harness.state;
    state.cardMap['c2'].suit = '♠';
    const p2 = harness.player('P2');
    const card = p2.findValidCard('transform');
    expect(card).toBeNull();
  });
});
```

### 5.6 前后端契约一致性

```ts
describe('前后端契约', () => {
  const harness = new SkillTestHarness();

  it('每个 registerAction 都有对应的 defineAction', () => {
    harness.setup(createGameState({
      players: [
        { ..., name: 'P1', skills: ['杀', '闪', '桃'] },
      ],
      cardMap: {},
    }));

    const p1 = harness.player('P1');
    const frontendActionTypes = new Set(p1.availableActions().map(a => a.actionType));

    // 杀有 'use'，闪有 'respond'
    expect(frontendActionTypes).toContain('use');
    expect(frontendActionTypes).toContain('respond');
  });

  it('cardFilter 允许的牌 = validate 接受的牌', async () => {
    // 构造一手混合牌，验证 filter 和 validate 对每张牌的判定一致
    harness.setup(createGameState({
      players: [
        { ..., name: 'P1', hand: ['c1', 'c2', 'c3'], skills: ['杀'] },
        { ..., name: 'P2', skills: [] },
      ],
      cardMap: {
        c1: { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' },
        c2: { id: 'c2', name: '闪', suit: '♥', rank: '2', type: '基本牌' },
        c3: { id: 'c3', name: '桃', suit: '♦', rank: '3', type: '基本牌' },
      },
    }));

    const p1 = harness.player('P1');

    // 前端 filter: 只有杀能通过
    const validCard = p1.findValidCard('use');
    expect(validCard?.id).toBe('c1');

    // 后端 validate: 闪和桃应被拒绝
    const result = await harness.engine.dispatch({
      skillId: '杀', actionType: 'use', ownerId: 'P1',
      params: { cardId: 'c2', targets: ['P2'] }, baseSeq: 0,
    });
    expect(result.error).toBeDefined();
  });
});
```

---

## 六、实现要点

### 6.1 `baseSeq` 自动填充

所有 `PlayerSession` 的操作方法内部自动从 `engine.getState().seq` 读取当前 seq，测试代码永远不需要手动管理。

### 6.2 事件流索引

每个 `PlayerSession` 维护自己的 `lastEventIndex`。调用 `newEvents` 时从全局事件流中取增量，避免重复读取。

### 6.3 Pending 超时处理

测试中有两种方式处理 pending 超时：

1. **`vi.useFakeTimers()` + `vi.advanceTimersByTime()`**——推荐，精确控制时间
2. **手动调用 `engine.dispatch()` 消费 pending**——当 onTimeout 是 `无操作` 时，发一个空的 respond 也能消费 pending

注意：`vi.useFakeTimers()` 会影响 `createEngine` 内部的 `setTimeout`。harness 需要在 `setup` 之后才启用 fake timers，否则引擎初始化可能受影响。

### 6.4 多玩家并发

引擎的 `dispatch` 是串行的（单线程 async），不需要处理真正的并发。但测试代码可能需要"同时操作"——实际是两个 `await dispatch()` 串行执行，第二个会看到第一个的结果。Harness 不需要加锁。

### 6.5 事件流的 per-player 视图分叉

`getEvents()` 返回的是全局事件流（未经 per-player 分叉）。如果需要验证特定玩家看到的事件，需要根据 `AtomDefinition.toPlayerViews` 手动筛选。这是有意的简化——大多数测试只需要验证全局事件序列。

如果未来需要 per-player 事件断言，可以扩展 `PlayerSession`：

```ts
/** 获取该玩家视角的事件（经过 toPlayerViews 分叉） */
getPlayerEvents(): GameEvent[];
```

### 6.6 测试分区与文件布局

```
tests/
├── engine-harness.ts              ← SkillTestHarness + PlayerSession + FakeFrontendAPI
├── setup.ts                       ← 现有 setup（jsdom 等）
├── skill-tests/                   ← 独立分区，不参与核心开发测试
│   ├── 杀.test.ts
│   ├── 闪.test.ts
│   ├── 八卦阵.test.ts
│   ├── 遗计.test.ts
│   ├── 武圣.test.ts
│   ├── 反馈.test.ts
│   ├── 护甲.test.ts
│   ├── ...（每个技能一个文件）
│   └── contract.test.ts           ← 前后端契约一致性检查
├── scenarios/                     ← 旧引擎场景测试（保留，逐步迁移）
├── integration/                   ← 引擎集成测试
└── ...（其他现有目录不动）
```

**与现有测试的关系**：

| 现有文件 | 处理 | 原因 |
|---|---|---|
| `tests/scenario-runner.ts` | 保留，不修改 | 旧引擎测试，迁移完前不能删 |
| `tests/engine-helpers.ts` | 保留 | `createTestGame` 等辅助函数仍被旧测试使用 |
| `tests/integration/new-engine-*.test.ts` | 保留 | 核心引擎流程验证，归 core 分区 |
| `tests/scenarios/**/*.test.ts` | 保留 | 旧引擎场景，归 core 分区，逐步迁移 |
| `tests/frontend/actions.ts` | 保留 | 旧前端测试辅助 |

### 6.7 vitest workspace 配置

**`vitest.workspace.ts`**：

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // 核心测试：引擎 + 服务端 + 客户端 + 旧场景
  {
    extends: 'vitest.config.ts',
    test: {
      name: 'core',
      exclude: ['tests/skill-tests/**'],
    },
  },
  // 技能测试：独立运行，每个文件独立 worker
  {
    extends: 'vitest.config.ts',
    test: {
      name: 'skills',
      include: ['tests/skill-tests/**/*.test.ts'],
      // 每个 test file 在独立 worker 中运行，隔离全局状态
      // （registerSkillModule/registerActionEntry/hooks 都是模块级 Map）
      pool: 'forks',
      poolOptions: { forks: { isolate: true } },
    },
  },
]);
```

**`package.json` scripts**：

```json
{
  "test": "vitest run --project core",
  "test:skills": "vitest run --project skills",
  "test:all": "vitest run",
  "test:watch": "vitest --watch --project core",
  "test:skills:watch": "vitest --watch --project skills"
}
```

**开发工作流**：

| 场景 | 命令 | 说明 |
|---|---|---|
| 改引擎代码 | `npm test` | 只跑 core，不触发技能测试 |
| 写/改技能 | `npm run test:skills` | 只跑技能测试 |
| 改技能模块 + 引擎 | `npm run test:all` | 两个项目都跑 |
| 技能开发中热跑 | `npm run test:skills:watch` | 只监听技能测试变更 |
| CI | `npm run test:all` | 全量，失败独立报告 |

### 6.8 全局状态隔离

技能测试的每个文件都在独立 worker（fork）中运行。这意味着：

 `registerSkillModule` 的模块级 Map 在每个 worker 中独立
 `beforeHooks` / `afterHooks` 不会跨文件污染
 `event-stream.ts` 的全局 `events[]` 数组不会串扰
 `createEngine().resetForTest()` 在文件内部负责本文件的清理

**代价**：fork 启动有额外开销（约 50ms/文件）。对于 40+ 技能测试文件，总开销约 2-3 秒，可接受。

**替代方案**：如果 fork 开销不可接受，可以用单 worker + 严格的 `beforeEach(() => harness.setup(...))` 保证隔离。但全局 Map 的清理依赖 `resetForTest()` 的完整性——如果某个新注册表被遗忘清理，就会出诡异 bug。fork 隔离更安全。

### 6.9 不做的事

- **不 mock `EngineApi`**：harness 用真实的 `createEngine`，所有 hooks 真实执行
- **不 mock `BackendAPI`**：`onInit` 真实注册，`apply` 走真实 pipeline
- **不渲染 DOM**：`playEffect` 和 `onEvent` 在 `FakeFrontendAPI` 中空操作
- **不替代 E2E**：harness 不测 WebSocket、不测 UI 渲染
- **不测试动画**：`AtomEffect` 声明是静态配置，不需要运行时验证

---

## 七、测试覆盖率目标

### 7.1 每个技能必测场景

| 场景类别 | 覆盖内容 | 例子 |
|---|---|---|
| **Happy path** | 正常使用，预期结果 | 出杀扣血、出闪闪避 |
| **Filter 一致性** | 前端 cardFilter = 后端 validate | 杀只能出杀牌，不能出闪 |
| **边界** | 极端输入 | 没有合法牌时不可用、出杀次数耗尽 |
| **交互** | 涉及 pending 的多步流程 | 杀→闪、遗计确认→分配 |
| **钩子交互** | 多个技能的钩子同时触发 | 八卦阵+杀、遗计+反馈同时触发 |

### 7.2 技能分类测试要求

| 类型 | 必测 | 代表 |
|---|---|---|
| **主动技** | validate + execute + defineAction 一致性 | 杀、仁德、制衡 |
| **被动技** | 钩子触发条件 + 副作用 | 护甲、八卦阵 |
| **转化技** | cardFilter + transform + 还原 | 武圣 |
| **锁定技** | 无条件触发 + 副作用 | 遗计、反馈 |
| **装备技** | 装备/卸载 + 钩子 | 青龙偃月刀、仁王盾 |

---

## 八、实现计划

### Phase 0：测试分区

- [ ] 创建 `vitest.workspace.ts`（core + skills 两个 project）
- [ ] 更新 `package.json` scripts（`test` / `test:skills` / `test:all`）
- [ ] 创建 `tests/skill-tests/` 目录
- [ ] 确认 `npm test` 不触发 `tests/skill-tests/**`

### Phase 1：基础设施

- [ ] 实现 `FakeFrontendAPI`
- [ ] 实现 `PlayerSession`（基本操作方法 + 事件流断言）
- [ ] 实现 `SkillTestHarness`
- [ ] 创建 `tests/engine-harness.ts`
- [ ] 迁移 `new-engine-kill.test.ts` 到 `tests/skill-tests/杀.test.ts`（harness 写法）

### Phase 2：Pending 处理

- [ ] 支持 `vi.useFakeTimers()` 的超时场景
- [ ] 嵌套等待的处理（八卦阵、无懈可击链）
- [ ] `expectPending` / `expectNoPending` 断言

### Phase 3：契约验证

- [ ] `findValidCard` / `findValidTargets`（跑前端 filter）
- [ ] 前后端 filter 一致性自动检测
- [ ] `contract.test.ts`：每个 `registerAction` 都有 `defineAction` 对应

### Phase 4：技能迁移

- [ ] 将现有 `tests/scenarios/` 下的场景逐步迁移到 `tests/skill-tests/`
- [ ] 为所有已实现技能补充 harness 测试
- [ ] 全部迁移完成后删除旧 `scenario-runner.ts`
