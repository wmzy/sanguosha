# create-engine 重构设计

> 把 `createEngine()` 从"闭包工厂 + 不可变 state + 实例方法"重构为"句柄(state)+ 顶层函数 + 原地变更 state",贴近 skill 模块的"create 工厂 + 顶层注册"模式。

**日期**: 2026-06-12
**状态**: 设计完成,待用户 review
**前置依赖**: `src/engine/create-engine.ts` 当前实现、ADR-0013(技能/角色解耦)、`docs/superpowers/specs/2026-06-09-engine-rewrite-design.md`

---

## 1. 目标与边界

### 1.1 目标

- **API 形态重塑**:`create()` 返回 `GameState` 本身(不是 wrapper);`dispatch` / `buildView` / `fireTimeout` / `resetForTest` 全部为顶层函数,以 `state` 作首参
- **去掉不可变包装**:所有状态变更走 atom,atom 直接 mutate `state` 字段;`state` 是常规可变对象,引用稳定
- **删除 `runtimeApi` 转发机制**:`_runtimeApi` / `setRuntimeApi` / `BackendAPI.apply/notify` 全部移除(确认零外部使用)
- **技能实例注册下放**:`rebootstrap(state)` 提到 `skill.ts` 为顶层函数,`开局.start` 不再承担注册职责
- **`bootstrap` 并入 `create`**:新游戏入口 `create(gameConfig)` 一次完成建 state + dispatch 开局 start + rebootstrap

### 1.2 范围

**改**
- `src/engine/create-engine.ts` —— 顶层函数化、删除 `EngineInstance`
- `src/engine/engine-api.ts` —— 接收 state 作首参、原地变更
- `src/engine/atom.ts` —— `applyAtom` 签名 `→ void`
- `src/engine/skill.ts` —— 删 `_runtimeApi` / `setRuntimeApi` / `makeBackendAPI.apply/notify`;新增顶层 `rebootstrap(state)`;`BackendAPI` 接口收缩
- `src/engine/types.ts` —— `AtomDefinition.apply` 签名 `→ void`
- 43 个 `src/engine/atoms/*.ts` —— `apply` 改为原地变更
- `src/server/session.ts` —— 删 `engine: EngineInstance`,改 `state: GameState`;`restoreState` 改 `restoreFromLog`
- `src/server/app.ts` —— `session.restoreState` 调用点改 `restoreFromLog`
- `tests/engine-harness.ts` —— 删 `engine` 字段,改顶层函数导入
- `tests/engine-helpers.ts` —— 改 `createTestEngine` 内部实现
- 6 个 `tests/integration/new-engine-*.test.ts` —— 顶层函数调用形态

**不改**
- `skill.ts` 的全局实例表 / `event-stream` 的全局缓冲(单例 OK)
- atom 的 `validate` / `pending` / `toPlayerViews` / `effect` 字段签名
- `getSkillModule` / `registerSkillModule` / `registerAtom` / `getAtomDef` 等注册接口
- `SettlementFrame` / `PendingSlot` / `GameView` / `GameState` 等核心数据结构
- `buildView` 内部逻辑
- 协议层 `ClientMessage` / `ServerMessage` / `ActionPrompt`

### 1.3 非目标

- 不实现真正的多 engine 隔离(单 engine 假设,模块级 `activeExecuteP`)
- 不改 RNG / 持久化格式(只调整 `restoreFromLog` 的调用)
- 不做 client 端的 stale-closure 审计(契约层做,客户端按需跟进)

---

## 2. 架构

### 2.1 模块导出(`src/engine/create-engine.ts`)

```ts
import { createGameState } from './types';
import { rebootstrap, clearAllSkillInstances } from './skill';
import { clearEvents } from './event-stream';

export interface DispatchResult {
  state: GameState;
  error?: string;
  gameOver?: boolean;
  winner?: string;
}

export interface GameConfig {
  characters: Array<{ name: string; skills: string[] }>;
  playerCount: number;
  seed: number;
  gameId: string;
  handSize?: number;
}

/** 创建新游戏:空 state → dispatch 开局 start → rebootstrap → 返回 */
export async function create(gameConfig: GameConfig): Promise<{ state: GameState; result: DispatchResult }>;

/** 主 / 回应 dispatch */
export async function dispatch(state: GameState, msg: ClientMessage): Promise<DispatchResult>;

/** 构造玩家视图 */
export function buildView(state: GameState, viewer: number): GameView;

/** 立即触发 pending 的 onTimeout(测试用) */
export async function fireTimeout(state: GameState): Promise<DispatchResult>;

/** 重置 skill 实例表 + event stream + 创建新 state */
export function resetForTest(state: GameState): void;
```

`state` 是常规可变 `GameState` 对象。函数不持有任何闭包状态(除模块级 `activeExecuteP`)。

### 2.2 `rebootstrap` 在 `skill.ts`

```ts
/** 遍历 state.players,给每个 skill 调 onInit 注册实例(并保存 unload) */
export function rebootstrap(state: GameState): void {
  for (const player of state.players) {
    for (const skillId of player.skills) {
      instantiateSkill(skillId, player.name);
    }
  }
}
```

`rebootstrap` **不走 start action**——是独立函数,任何时候 `state.players` 变化后都可调(目前主要在 `create()` 完成后调用)。

### 2.3 模块级单例(单 engine 假设)

```ts
// src/engine/create-engine.ts 内部
let activeExecuteP: Promise<void> | undefined;
```

仅用于回应路径:当一个 dispatch 挂了(等 pending),后续 dispatch 拿到 `state.pendingSlot` 时,把当前 execute 的 promise 存进 `activeExecuteP`,回应跑完原始 execute 后 await 它取最终 state。回归到单 engine 串行(同 `createEngine` 旧实现语义)。

不引入 `WeakMap<GameState, EngineSession>`——简化设计;真要并行多 engine 时再单独开 ADR。

### 2.4 删 `runtimeApi` 机制

`services/skill.ts` 删除:
```ts
let _runtimeApi: EngineApi | null = null;       // 删
export function setRuntimeApi(api) { ... }       // 删
// makeBackendAPI 中:
apply(atom) { return _runtimeApi.apply(atom); }  // 删
notify(event) { _runtimeApi.notify(event); }     // 删
```

`BackendAPI` 接口收缩为 `self + registerAction + onAtomBefore + onAtomAfter`(原 types.ts:467)。

**审计结论**:`grep` 全部 skill 文件,无任何 `onInit` 内部调用 `api.apply` / `api.notify`——`api.apply` / `api.notify` 路径全在 `registerAction` execute(`EngineApi` 直接拿)或 hook 上下文(`ctx.api` = `EngineApi`)。删除零风险。

---

## 3. 数据流

### 3.1 新游戏流程

```ts
// session.startGame
const { state, result } = await create(gameConfig);
this.state = state;
this.sendInitialViewToAll();
```

`create` 内部:
1. `state = createGameState({ players: [], cardMap: {} })` — 工厂建空 state
2. `ensureStateShape(state)`(原地补缺失字段);`state.startedAt = Date.now()`
3. `result = await dispatch(state, { skillId: '开局', actionType: 'start', ownerId: '主公', params: gameConfig, baseSeq: 0 })` —— 开局 start 跑 atom 流程(抽身份/选将/洗牌/发牌/回合开始),期间产生新 players
4. `rebootstrap(state)` —— 给所有 players(包括选将生成的新 players)注册 skill 实例
5. 返回 `{ state, result }`

### 3.2 单次 dispatch(主动 action)

```ts
const result = await dispatch(state, msg);
```

内部:
1. 找 action entry(`findActionEntry`);若 `actionType === 'use'` 且 card 为装备牌,fallback 到 `装备通用`
2. `entry.validate(view, msg.params)` 校验
3. 创建 `EngineApi`(新 `EngineContext { state, self: msg.ownerId, messageParams, fireDispatchReady }`)
4. 启动 `entry.execute(api)` 作为 promise,赋值给模块级 `activeExecuteP`
5. 等待 `dispatchReady` promise(挂起 / 完成都触发)
6. 同步 `activeExecuteP` 完成
7. 同步 `state.seq += 1`;记 actionLog;检查 gameOver
8. 返回 `{ state, gameOver, winner }`

注意:`state.seq += 1` 现在是**原地变更**(以前是 `{ ...state, seq: state.seq + 1 }`)。

### 3.3 回应 action 路径

```ts
// 假设上一步 dispatch 仍在挂起(state.pendingSlot 已设置)
const result = await dispatch(state, responseMsg);
```

内部:
1. 检查 `state.pendingSlot` 存在
2. 检查 `responseMsg.ownerId === pending.atom.target`
3. 找回应 action entry,`entry.validate`
4. 创新 `EngineApi` 跑 `entry.execute(api)`(可能 nested apply)
5. 由于 `state` 是引用,所有变更**自动**反映到原始 execute 看到的 `ctx.state`
6. `state.pendingSlot.resolve()` 解除挂起
7. `await activeExecuteP` 等原始 execute 完成
8. 同步 seq / logAction / checkGameOver,返回

**关键简化**:以前要 `activeExecuteCtx.state = ctx.state` 同步 state;现在原地变更,不需要。

### 3.4 持久化恢复(快照兼容 + replay 恢复)

```ts
// session.restoreFromLog(gameConfig, actionLog)
const { state } = await create(gameConfig);
this.state = state;
for (const log of actionLog) {
  // actionLog[0] 是开局的 start(create 已执行),跳过
  if (log.message.skillId === '开局' && log.message.actionType === 'start') continue;
  await dispatch(this.state, log.message);
}
```

`PersistedRoom.state` 字段保留(供重连时初始 view 渲染),但**不再喂给引擎**——引擎只看 `(gameConfig, actionLog)`,replay 重建。

`app.ts:117` 调用点改为:
```ts
await session.restoreFromLog(
  { characters, playerCount, seed, gameId },  // 从 PersistedRoom.players + seed 装配
  persisted.actionLog,
);
```

---

## 4. API 迁移表

| 旧 API | 新 API |
|---|---|
| `createEngine(): EngineInstance` | `create(gameConfig): Promise<{ state, result }>` |
| `engine.dispatch(msg)` | `dispatch(state, msg)` |
| `engine.buildView(viewer)` | `buildView(state, viewer)` |
| `engine.getState()` | `state`(直接读)或 `readState(state)`(为对称) |
| `engine.bootstrap(s)` | 删除(并入 `create`) |
| `engine.rebootstrap()` | `rebootstrap(state)`(`skill.ts` 顶层) |
| `engine.resetForTest()` | `resetForTest(state)` |
| `engine.fireTimeout()` | `fireTimeout(state)` |
| `session.engine: EngineInstance` | `session.state: GameState` |
| `session.restoreState(state, log)` | `session.restoreFromLog(gameConfig, log)` |
| `harness.engine.dispatch(...)` | `dispatch(harness.state, ...)` |
| `harness.engine.buildView(idx)` | `buildView(harness.state, idx)` |
| `harness.engine.getState()` | `harness.state` |
| `harness.engine.fireTimeout()` | `fireTimeout(harness.state)` |
| `harness.engine.resetForTest()` | `resetForTest(harness.state)` |

---

## 5. 关键设计点

### 5.1 atom mutation 模板

```ts
// 摸牌
apply(state, atom) {
  const idx = state.players.findIndex(p => p.name === atom.player);
  const drawn = state.zones.deck.slice(-atom.count).reverse();
  state.zones.deck = state.zones.deck.slice(0, -atom.count);
  state.players[idx].hand.push(...drawn);
}

// 造成伤害
apply(state, atom) {
  const targetIdx = state.players.findIndex(p => p.name === atom.target);
  const target = state.players[targetIdx];
  target.health = Math.max(0, target.health - atom.amount);
  target.alive = target.health > 0;
}

// 弃置(多 cardIds)
apply(state, atom) {
  const idx = state.players.findIndex(p => p.name === atom.player);
  const toRemove = new Set(atom.cardIds);
  state.players[idx].hand = state.players[idx].hand.filter(id => !toRemove.has(id));
}
```

`validate(state, atom)` 不变——纯读,不动 state。

### 5.2 `applyAtom` 签名变化

```ts
// atom.ts
export function applyAtom(state: GameState, atom: Atom): void {
  getAtomDef(atom.type).apply(state, atom);
}
```

### 5.3 `engine-api.ts` 关键改动

```ts
// 改前
ctx.state = applyAtom(ctx.state, atom);
ctx.state = pushFrame(ctx.state, frame);

// 改后
applyAtom(ctx.state, atom);
state.settlementStack.push(frame);
```

`ctx.state` 在 `apply()` 闭包内被多处读 / 写(为当前 frame / pending 等),全部改为直接读写字段。

### 5.4 `EngineContext` 简化

旧:
```ts
export interface EngineContext {
  state: GameState;        // 可写引用
  messageParams: Record<string, Json>;
  self: string;
  fireDispatchReady: () => void;
}
```

新:同样接口,但 `state` 字段被四处共享同一引用(改谁都能看到)。

### 5.5 `getState()` 概念删除

旧 `engine.getState(): GameState` 单纯返回闭包 `currentState`。新设计中 `state` 是调用方持有的变量,直接用即可。

为保持对称可暴露一个 `readState(state): GameState`(`return state`),但不必要。

### 5.6 `ensureStateShape` 改为原地

```ts
function ensureStateShape(state: GameState): void {
  if (!state.cardWrappers) state.cardWrappers = {};
  if (!state.atomStack) state.atomStack = [];
  if (!state.settlementStack) state.settlementStack = [];
  for (const p of state.players) {
    if (!p.judgeZone) p.judgeZone = [];
    if (!p.tags) p.tags = [];
  }
}
```

返回 `void`,不返新 state。

---

## 6. 测试迁移

### 6.1 `tests/engine-harness.ts`

```ts
// 改前
import { createEngine, type EngineInstance } from '../src/engine/create-engine';

export class SkillTestHarness {
  readonly engine: EngineInstance;
  constructor() { this.engine = createEngine(); }
  setup(state: GameState): void {
    this.engine.resetForTest();
    this.engine.bootstrap(state);
    // sessions ...
  }
}

// 改后
import { resetForTest, dispatch, buildView, fireTimeout } from '../src/engine/create-engine';
import { rebootstrap } from '../src/engine/skill';

export class SkillTestHarness {
  state!: GameState;
  setup(state: GameState): void {
    resetForTest(state);
    rebootstrap(state);
    this.state = state;
    // sessions ...
  }
}
```

`PlayerSession.dispatch / view / pass / newEvents / expectPending` 等内部全部改用顶层函数 / `this.harness.state`。

### 6.2 `tests/integration/new-engine-*.test.ts`

6 个文件(`kill` / `hujia` / `rende` / `fire-timeout` / `server-gameplay` / `engine-isolation`),每个:
- `import { create, dispatch, buildView, fireTimeout, resetForTest } from '../../src/engine/create-engine'`
- `import { rebootstrap } from '../../src/engine/skill'`
- `let state: GameState;` 替 `let engine: EngineInstance;`
- `beforeEach`: 不再 `createEngine() + resetForTest() + bootstrap()`,改为 `state = buildInitialState(); resetForTest(state); rebootstrap(state);`
- `engine.dispatch(...)` → `await dispatch(state, ...)`
- `engine.getState()` → `state`
- `engine.buildView(idx)` → `buildView(state, idx)`
- `engine.fireTimeout()` → `fireTimeout(state)`

### 6.3 `tests/engine-helpers.ts`

```ts
// 改前
export function createTestEngine(): EngineInstance {
  return createEngine({ skills: allSkills });
}

// 改后
export async function createTestGame(): Promise<{ state: GameState; result: DispatchResult }> {
  return create({ characters: allCharacters, playerCount: 2, seed: 42, gameId: 'test' });
}
```

(详细函数体可保留原 `createTestGame(opts)` 形态,内部改为 `await create(...)`。)

### 6.4 新增审计(可选,本 spec 不强制)

- 审计所有 atom 是否只用 `mulberry32(state.rngSeed)`,不出现 `Math.random()` / `Date.now()`(除 `startedAt` / `actionLog.timestamp`)
- 审计所有 skill 的 `onInit` / `onAtomBefore` / `onAtomAfter` 中是否有 `api.apply` 之外的 state 修改路径(应该没有)

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **43 个 atom 改 mutation 工作量大** | 机械工作,逐文件改;保留 validate 不动;每改一个跑全量测试 |
| **state 引用稳定性变化**:React 端可能有 `useMemo([state])` 缓存 | 客户端不做本次范围,留 issue 跟进;契约层 `state` 引用创建时不变,后续 mutate |
| **replay 失败**:某个 atom 用 `Date.now()` 等非种子源,replay 出不同 state | spec 6.4 审计;若发现,改为读 `state.rngSeed` 派生 |
| **`session.restoreFromLog` 跳过开局 start**:依赖 actionLog 顺序 | 显式 `if` 判断,加注释 + 测试覆盖 |
| **`create` 是 async**:调用方 `await` 必要 | `session.startGame` 本来就 async,无回归 |
| **`activeExecuteP` 模块级导致多 engine 串行** | 当前 usage 单 engine,接受;真要并行单独开 ADR |
| **`skill.ts` / `event-stream` 仍是模块级**:vitest 单线程 OK,但跨测试文件仍共享 | `resetForTest` 清两端;新测试用 `beforeEach` 调 |
| **`app.ts:117` 改 `restoreFromLog` 时装配 gameConfig** | 需要从 `PersistedRoom.players` 重新组装 `characters` 数组(从 `CharacterConfig` 查 skills);现有 `restoreToState` 旁路即可删除 |
| **client 端 stale closure** | 本次不动;后续 React 组件按需 `useEffect` 监听 state 引用 |
| **破坏性 `EngineInstance` 删**:外部调用全部要改 | `git mv` 旧 `create-engine.ts` → `create-engine.legacy.ts`,新文件 `create-engine.ts` 直接替换;一次性 commit 后 build / test 全绿 |

---

## 8. 实施顺序(粗略)

1. **底层先动**:`atom.ts` 改 `applyAtom → void`、`AtomDefinition.apply → void` 类型签名(全 43 个 atom 同步改 mutation)
2. **`engine-api.ts` 改**:接收 state、原地变更、`activeExecuteP` 模块级
3. **`skill.ts` 改**:删 runtimeApi、新增 `rebootstrap(state)`、缩 `BackendAPI`
4. **`create-engine.ts` 重写**:顶层函数 + `create(gameConfig)` + `dispatch(state, msg)` + 其他
5. **`session.ts` 改**:删 `engine`,改 `state`;`startGame` 走 `create`;`restoreState` 改 `restoreFromLog`
6. **`app.ts` 改**:装配 `gameConfig` 给 `restoreFromLog`
7. **`tests/engine-harness.ts` + `tests/engine-helpers.ts` 改**
8. **6 个 integration test 改**
9. **全量测试 + typecheck + lint**
10. **写 ADR 记录这次重构**

---

## 9. 验收标准

- [ ] `pnpm typecheck` 通过(0 错误)
- [ ] `pnpm test` 全量通过(所有 unit + integration + skill-tests)
- [ ] `pnpm lint` 通过
- [ ] `createEngine` / `EngineInstance` / `setRuntimeApi` / `_runtimeApi` / `Bootstrap` 函数 0 引用(`grep` 验证)
- [ ] `create(gameConfig)` 一次调用产生完整可玩 state(主公选将完成 + 4 张起始手牌)
- [ ] `restoreFromLog(gameConfig, actionLog)` 产生与原始 session 等价的 state
- [ ] 所有 43 个 atom 的 `apply` 返回 `void`(`tsc` 强制)
- [ ] 至少 1 个 integration test 覆盖 `restoreFromLog` 路径(避免 skip 开局 start 的回归)
- [ ] ADR 写好并 commit
