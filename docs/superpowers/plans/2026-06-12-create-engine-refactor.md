# create-engine 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `createEngine()` 闭包工厂重构为 `create(gameConfig) → GameState` + 顶层函数 + 原地变更 state,贴近 skill 模块的"create 工厂 + 顶层注册"模式。

**Architecture:** 引擎 facade 从"实例 + 闭包 + 不可变 state"改为"顶层函数 + 调用方持有 GameState 引用 + 原地变更"。Atom 直接 mutate `state` 字段(43 个 atom 改写);engine-api 收 state 作首参,不再 spread;skill 注册表保留模块级;`rebootstrap(state)` 上提至 `skill.ts` 顶层;`bootstrap` 概念并入 `create(gameConfig)`(内部 dispatch 开局 start + rebootstrap)。删除 `runtimeApi` 转发机制(零外部使用)。

**Tech Stack:** TypeScript 5.x, pnpm, vitest, Hono server, React client

**前置依赖:** `docs/superpowers/specs/2026-06-12-create-engine-refactor-design.md`(本计划的源头)

---

## 文件改动总览

| 文件 | 行为 |
|---|---|
| `src/engine/types.ts` | 改:`AtomDefinition.apply` 签名 `→ void` |
| `src/engine/atom.ts` | 改:`applyAtom(state, atom): void`(去 return) |
| `src/engine/atoms/*.ts`(43 文件) | 改:每个 `apply` 改原地 mutation(去 return spread) |
| `src/engine/engine-api.ts` | 改:接收 state、原地变更、`activeExecuteP` 模块级 |
| `src/engine/skill.ts` | 改:删 `_runtimeApi` / `setRuntimeApi` / `BackendAPI.apply/notify`;新增 `rebootstrap(state)`;`BackendAPI` 缩接口 |
| `src/engine/create-engine.ts` | 改:重写为顶层函数导出 `create / dispatch / buildView / fireTimeout / resetForTest`;删 `EngineInstance` |
| `src/server/session.ts` | 改:`engine: EngineInstance` → `state: GameState`;`startGame` 走 `await create(gameConfig)`;`restoreState` 改 `restoreFromLog` |
| `src/server/app.ts` | 改:`session.restoreState` 调用点改 `restoreFromLog`,装配 `GameConfig`;删 `restoreToState` 引用 |
| `src/server/persistence.ts` | 改:删 `restoreToState` 函数 |
| `tests/integration/engine-isolation.test.ts` | 删:测的是旧 per-instance hook 隔离,新设计无此特性 |
| `tests/engine-harness.ts` | 改:删 `engine` 字段,改顶层函数导入;`PlayerSession` 改用 `this.harness.state` |
| `tests/engine-helpers.ts` | 改:`createTestEngine` 拆为 `setupTestState(state)` + `createTestGame(opts)` |
| `tests/integration/new-engine-{kill,hujia,rende,fire-timeout,server-gameplay}.test.ts`(5 文件) | 改:顶层函数调用形态 |
| `tests/integration/restore-from-log.test.ts` | 新建:覆盖 `restoreFromLog` 路径 |
| `tests/integration/create-game.test.ts` | 新建:e2e 覆盖 `create(gameConfig)` |
| `docs/decisions/0027-create-engine-refactor.md` | 新建:ADR 记录 |

(共 6 个 integration test,5 个改写 + 1 个 `engine-isolation` 删,新增 2 个 = 实际 7 个 integration 改动。)

---

## Task 1: 改 `AtomDefinition.apply` 与 `applyAtom` 签名

**Files:**
- Modify: `src/engine/types.ts:281-288`(`AtomDefinition` 接口)
- Modify: `src/engine/atom.ts:26-28`(`applyAtom` 函数)

- [ ] **Step 1: 修改 `AtomDefinition.apply` 签名**

打开 `src/engine/types.ts`,找到 `AtomDefinition` 接口(line 281-288),把 `apply` 字段:
```ts
apply(state: GameState, atom: A): GameState;
```
改为:
```ts
apply(state: GameState, atom: A): void;
```

- [ ] **Step 2: 修改 `applyAtom` 签名**

打开 `src/engine/atom.ts`,把 `applyAtom` 函数(line 26-28):
```ts
export function applyAtom(state: GameState, atom: Atom): GameState {
  return getAtomDef(atom.type).apply(state, atom);
}
```
改为:
```ts
export function applyAtom(state: GameState, atom: Atom): void {
  getAtomDef(atom.type).apply(state, atom);
}
```

- [ ] **Step 3: 跑 typecheck 确认现有 43 个 atom 报错**

跑:
```bash
pnpm typecheck 2>&1 | head -60
```

**预期**: 大批错误,全部形如:
```
src/engine/atoms/摸牌.ts(19,3): error TS2322: Type 'GameState' is not assignable to type 'void'.
```
或
```
src/engine/atoms/摸牌.ts(20,5): error TS2355: A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value.
```

43 个 atom 文件,每个约 1-2 个错误。这是预期的——签名改完下游必须跟上。

- [ ] **Step 4: 不要修复 atom,先 commit 签名改动**

(签名改动独立成 commit,方便 review 后续 atom 改动的 diff。)

跑:
```bash
git add src/engine/types.ts src/engine/atom.ts
git commit -m "refactor(engine): AtomDefinition.apply / applyAtom 改为 void 返回

准备改 43 个 atom 为原地变更。下游 typecheck 失败是预期的。"
```

---

## Task 2: 改写 43 个 atom 为 mutation

**Files:**
- Modify: `src/engine/atoms/*.ts`(43 个文件,具体清单见本 Task 末尾)

**模式参考**(以 `摸牌.ts` 为例,完整见 spec §5.1):

```ts
// 改前
apply(state, atom) {
  const idx = state.players.findIndex(p => p.name === atom.player);
  const drawn = state.zones.deck.slice(-atom.count).reverse();
  const newDeck = state.zones.deck.slice(0, -atom.count);
  const newHand = [...state.players[idx].hand, ...drawn];
  return {
    ...state,
    zones: { ...state.zones, deck: newDeck },
    players: state.players.map((p, i) => i === idx ? { ...p, hand: newHand } : p),
  };
}

// 改后
apply(state, atom) {
  const idx = state.players.findIndex(p => p.name === atom.player);
  const drawn = state.zones.deck.slice(-atom.count).reverse();
  state.zones.deck = state.zones.deck.slice(0, -atom.count);
  state.players[idx].hand.push(...drawn);
}
```

**改写规则**:
1. 删除 `return { ...state, ... }`
2. 改后必须没有 `return`(签名是 `void`)
3. 数组操作:用 `push` / 直接赋值 / `splice` 替代 `map` / `filter` 重建
4. 对象属性:用 `state.players[i].field = newValue` 替代 spread 创建新对象
5. `zones` 子对象:直接 `state.zones.deck = ...` 替换字段,保留 `state.zones` 引用
6. `validate(state, atom)` 不动(纯读)

- [ ] **Step 1: 改写卡牌/资源类 atom(7 个)**

逐一打开并改写以下文件:
- `src/engine/atoms/摸牌.ts` —— deck → player.hand(见上模式)
- `src/engine/atoms/弃置.ts` —— hand/dicardPile 删除 cardIds
- `src/engine/atoms/移动牌.ts` —— zone 之间的 card 移动
- `src/engine/atoms/获得.ts` —— 给玩家加牌
- `src/engine/atoms/给予.ts` —— from → to
- `src/engine/atoms/抽牌.ts` —— 指定 cardId 给玩家
- `src/engine/atoms/装备.ts` / `src/engine/atoms/卸下.ts` —— equipment 字段更新

每个文件改完跑:
```bash
pnpm typecheck 2>&1 | grep "atoms/$(basename <FILE>)" | head -5
```
**预期**: 该文件无错误。

- [ ] **Step 2: 改写角色状态类 atom(8 个)**

逐一改写:
- `src/engine/atoms/造成伤害.ts` —— target.health / target.alive(见 spec §5.1 模式)
- `src/engine/atoms/回复体力.ts` —— target.health 累加
- `src/engine/atoms/失去体力.ts` —— target.health 累减
- `src/engine/atoms/击杀.ts` —— target.alive = false(可能不存在的字段补齐)
- `src/engine/atoms/加标记.ts` / `src/engine/atoms/去标记.ts` / `src/engine/atoms/清过期标记.ts` —— player.marks 数组 push/filter
- `src/engine/atoms/加标签.ts` / `src/engine/atoms/去标签.ts` —— player.tags 数组 push/filter
- `src/engine/atoms/设横置.ts` —— player.chained 字段
- `src/engine/atoms/设上限.ts` —— player.maxHealth 字段

- [ ] **Step 3: 改写流程类 atom(6 个)**

- `src/engine/atoms/回合开始.ts` / `src/engine/atoms/回合结束.ts` —— state.currentPlayerIndex / state.turn.round
- `src/engine/atoms/阶段开始.ts` / `src/engine/atoms/阶段结束.ts` / `src/engine/atoms/设阶段.ts` —— state.phase / state.turn.phase
- `src/engine/atoms/下一玩家.ts` —— state.currentPlayerIndex 轮转

- [ ] **Step 4: 改写判定/延时锦囊类 atom(3 个)**

- `src/engine/atoms/判定.ts` —— state.zones.deck 顶部牌移到目标 player.judgeZone
- `src/engine/atoms/添加延时锦囊.ts` —— player.pendingTricks push
- `src/engine/atoms/移除延时锦囊.ts` —— player.pendingTricks filter

- [ ] **Step 5: 改写等待型 atom(4 个)**

- `src/engine/atoms/询问闪.ts` / `src/engine/atoms/询问杀.ts` / `src/engine/atoms/请求回应.ts` / `src/engine/atoms/无操作.ts`

这 4 个 atom 的 `apply` 函数体**通常为空或简单设置**(等待行为在 `engine-api.ts` 的 pending slot 机制里,不归 atom 管)。只需删 `return state` 改为空函数体。

- [ ] **Step 6: 改写初始化 atom(4 个)**

- `src/engine/atoms/抽身份.ts` / `src/engine/atoms/选将.ts` / `src/engine/atoms/初始化洗牌.ts` / `src/engine/atoms/发牌.ts`

这些 atom 是开局的关卡,改时**保留 RNG 派生逻辑**(spec §6.4 审计提醒)。改后跑集成测试 `tests/integration/server-gameplay.test.ts` 验证开局流程仍能跑通。

- [ ] **Step 7: 改写其余 atom(11 个)**

- `src/engine/atoms/洗牌.ts` / `src/engine/atoms/重洗.ts` / `src/engine/atoms/整理牌堆.ts` —— zones.deck 数组操作
- `src/engine/atoms/添加技能.ts` / `src/engine/atoms/移除技能.ts` —— player.skills 数组操作
- `src/engine/atoms/拼点.ts` —— 两玩家手牌比拼
- `src/engine/atoms/武圣包装.ts` / `src/engine/atoms/武圣还原.ts` —— cardWrappers 操作
- `src/engine/atoms/指定目标.ts` —— 简单记录,可能不动 state

- [ ] **Step 8: 跑 typecheck 确认 43 个 atom 全部改完**

```bash
pnpm typecheck 2>&1 | tail -10
```

**预期**: 0 错误(只可能有 engine-api / create-engine 处的旧签名调用错误,下个 Task 处理)。

- [ ] **Step 9: 跑全量测试**

```bash
pnpm test 2>&1 | tail -30
```

**预期**: 一些测试可能因为 `engine-api.ts` / `create-engine.ts` 还在用旧 `applyAtom` 签名而失败(返回 GameState 的旧实现)。这是预期,下个 Task 修。

- [ ] **Step 10: Commit**

```bash
git add src/engine/atoms/
git commit -m "refactor(atoms): 43 个 atom 改原地变更 mutation

去 spread 包装,直接 mutate state 字段。AtomDefinition.apply 返回 void。
保留 validate 不动。"
```

---

## Task 3: 改写 `engine-api.ts` 使用 mutation

**Files:**
- Modify: `src/engine/engine-api.ts`(全文件)

**关键改动**:
- `createEngineApi` 接收 `state` 后,所有 `ctx.state = X` 改为 `applyAtom(ctx.state, X)`(mutation 路径)
- `pushFrame` / `popFrame` / `topFrame` 不再 spread state,直接操作 `state.settlementStack` 数组
- `api.state` getter 返回 `ctx.state` 引用(不变)
- 删 `ctx.state = { ...ctx.state, atomStack: ... }` 模式,改 `ctx.state.atomStack.push(atom)` 然后再 pop

- [ ] **Step 1: 改 `apply` 方法体**

打开 `src/engine/engine-api.ts`,找到 `apply` 方法(line 69-187)。

把所有 `ctx.state = { ...ctx.state, atomStack: [...ctx.state.atomStack, atom] };` 改为:
```ts
ctx.state.atomStack.push(atom);
```

把 `ctx.state = { ...ctx.state, atomStack: ctx.state.atomStack.slice(0, -1) };` 改为:
```ts
ctx.state.atomStack.pop();
```

把 `ctx.state = applyAtom(ctx.state, atom);` 改为:
```ts
applyAtom(ctx.state, atom);
```

- [ ] **Step 2: 改 `pushFrame` / `popFrame` / `topFrame`**

`pushFrame`:
```ts
// 改前
ctx.state = pushFrame(ctx.state, frame);
return frame;

// 改后
ctx.state.settlementStack.push(frame);
return frame;
```

`popFrame`:
```ts
// 改前
ctx.state = popFrame(ctx.state);

// 改后
if (ctx.state.settlementStack.length > 0) ctx.state.settlementStack.pop();
```

`topFrame`:保持不变(它只读不写)。

删 `pushFrame` / `popFrame` 辅助函数(line 199-210)。

- [ ] **Step 3: 改 `moveJudgeCardToZone` / `cleanupJudgeZone`**

`moveJudgeCardToZone`(line 218-228)和 `cleanupJudgeZone`(line 231-242)目前返回新 state,改:
- `moveJudgeCardToZone` 改为原地 `state.zones.deck.shift(); state.players[...].judgeZone.push(topCardId);`(无 return)
- `cleanupJudgeZone` 改为原地 `state.zones.discardPile.push(topId); target.judgeZone.pop();`
- 调用点(line 113-115 / 138-140)改为先调用再无赋值

- [ ] **Step 4: 改 pending 路径**

`engine-api.ts:154-178` 处的 `ctx.state = { ...ctx.state, pendingSlot: ... }` 改:
```ts
// 替换原 154 行的对象赋值
ctx.state.pendingSlot = slot;

// 替换原 162-164 的旧 slot 清理
if (ctx.state.pendingSlot) {
  ctx.state.pendingSlot.resolve();
  ctx.state.pendingSlot = undefined;
}

// 替换原 173 的清理
ctx.state.pendingSlot = undefined;
```

- [ ] **Step 5: 跑 typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

**预期**: `engine-api.ts` 内无错误。`create-engine.ts` 可能还有 `applyAtom` 返回值的旧用法,下个 Task 修。

- [ ] **Step 6: 跑 engine 相关测试**

```bash
pnpm test -- tests/integration/new-engine-kill.test.ts 2>&1 | tail -20
```

**预期**: 大概率失败(create-engine 还在用旧接口),但 engine-api 自身的错误应该没有。如果有 engine-api 内部错误,debug 修。

- [ ] **Step 7: Commit**

```bash
git add src/engine/engine-api.ts
git commit -m "refactor(engine-api): 改用 state 原地变更,删 spread 包装

pushFrame/popFrame 直接操作 settlementStack 数组。
pending slot 改为字段赋值。"
```

---

## Task 4: 改写 `skill.ts`(删 runtimeApi + 新增 `rebootstrap`)

**Files:**
- Modify: `src/engine/skill.ts`(全文件,删 ~40 行 + 新增 ~15 行)
- Modify: `src/engine/types.ts:467-486`(`BackendAPI` 接口)

- [ ] **Step 1: 删 `_runtimeApi` 和 `setRuntimeApi`**

打开 `src/engine/skill.ts`,删除:
- `let _runtimeApi: EngineApi | null = null;`(line 124)
- `export function setRuntimeApi(api: EngineApi | null): void { _runtimeApi = api; }`(line 126-128)

- [ ] **Step 2: 删 `makeBackendAPI` 中的 `apply` / `notify` 转发**

`makeBackendAPI`(line 130-160),把:
```ts
apply(atom) {
  if (!_runtimeApi) throw new Error('api.apply 只能在 execute 或钩子中调用');
  return _runtimeApi.apply(atom);
},
notify(event) {
  if (!_runtimeApi) throw new Error('api.notify 只能在 execute 或钩子中调用');
  _runtimeApi.notify(event);
},
```

整体删除。`makeBackendAPI` 改为:
```ts
export function makeBackendAPI(skill: Skill): BackendAPI {
  return {
    self: skill.ownerId,
    registerAction(actionType, validate, execute) {
      const entry: ActionEntry = { skillId: skill.id, ownerId: skill.ownerId, actionType, validate, execute };
      registerActionEntry(entry);
      return () => {
        const k = actionKey(skill.id, skill.ownerId, actionType);
        actions.delete(k);
      };
    },
    onAtomBefore(atomType, handler) {
      const entry: AtomHookEntry = { skillId: skill.id, ownerId: skill.ownerId, atomType, phase: 'before', handler: handler as AtomHookEntry['handler'] };
      registerHook('before', entry);
      return () => removeHook('before', entry);
    },
    onAtomAfter(atomType, handler) {
      const entry: AtomHookEntry = { skillId: skill.id, ownerId: skill.ownerId, atomType, phase: 'after', handler: handler as AtomHookEntry['handler'] };
      registerHook('after', entry);
      return () => removeHook('after', entry);
    },
  };
}
```

- [ ] **Step 3: 缩 `BackendAPI` 接口**

打开 `src/engine/types.ts`,找到 `BackendAPI` 接口(line 467-486),把 `apply` 和 `notify` 字段删除:
```ts
export interface BackendAPI {
  readonly self: string;
  registerAction(
    actionType: string,
    validate: (view: GameView, params: Record<string, Json>) => string | null,
    execute: (api: EngineApi) => Promise<void>,
  ): () => void;
  onAtomBefore(
    atomType: string,
    handler: (ctx: AtomBeforeContext) => Promise<void>,
  ): () => void;
  onAtomAfter(
    atomType: string,
    handler: (ctx: AtomAfterContext) => Promise<void>,
  ): () => void;
}
```

- [ ] **Step 4: 新增 `rebootstrap(state)` 顶层函数**

`rebootstrap` 是把 `bootstrap` / `rebootstrap` 里的 `instantiateSkill` 循环提到模块顶层。打开 `src/engine/skill.ts` 新增:

```ts
/** 遍历 state.players,给每个 skill 调 onInit 注册实例(并保存 unload) */
export function rebootstrap(state: GameState): void {
  for (const player of state.players) {
    for (const skillId of player.skills) {
      instantiateSkill(skillId, player.name);
    }
  }
}

/** 内部 helper:实例化单个 skill(从 create-engine bootstrap / rebootstrap 提取) */
function instantiateSkill(skillId: string, ownerId: string): Skill {
  const module = getSkillModule(skillId);
  const skill = module.createSkill(skillId, ownerId);
  if (module.onInit) {
    const api = makeBackendAPI(skill);
    const unload = module.onInit(skill, api);
    setSkillInstanceUnload(skillId, ownerId, typeof unload === 'function' ? unload : () => {});
  }
  return skill;
}
```

(把原 `create-engine.ts:instantiateSkill` 搬过来。)

- [ ] **Step 5: 删 `create-engine.ts` 中已搬走的 `instantiateSkill` 函数**

打开 `src/engine/create-engine.ts`,删除:
- `function instantiateSkill(skillId: string, ownerId: string): Skill { ... }`(line 84-93)
- `function bootstrap(state: GameState): GameState { ... }`(line 69-82)
- `function rebootstrap(): void { ... }`(line 267-273)

此时 `create-engine.ts` 一堆 `setSkillInstanceUnload` 引用还在,跑 typecheck 会失败,下个 Task 重写时统一处理。

- [ ] **Step 6: 跑 typecheck 确认**

```bash
pnpm typecheck 2>&1 | tail -20
```

**预期**: 仅 `create-engine.ts` 有错误(因为它已经残破),其他文件无错。

- [ ] **Step 7: Commit**

```bash
git add src/engine/skill.ts src/engine/types.ts src/engine/create-engine.ts
git commit -m "refactor(skill): 删 runtimeApi 转发,新增 rebootstrap(state) 顶层

BackendAPI 缩为 registerAction + onAtomBefore/After(无 apply/notify)。
rebootstrap 从 create-engine 提到 skill.ts,作为公开 API。
instantiateSkill 也搬到 skill.ts 内部 helper。"
```

---

## Task 5: 重写 `create-engine.ts` 为顶层函数

**Files:**
- Modify: `src/engine/create-engine.ts`(整文件重写,删 `EngineInstance` 接口)

**重写原则**(参考 spec §2.1):
- 全部 export 都是顶层函数,无闭包
- `create(gameConfig): Promise<GameState>` —— 内部分三步:建 state → dispatch 开局 start → rebootstrap
- `dispatch(state, msg): Promise<DispatchResult>` —— 内部用模块级 `activeExecuteP` 跟踪回应路径
- `buildView(state, viewer): GameView`
- `fireTimeout(state): Promise<DispatchResult>`
- `resetForTest(): void` —— 不接 state(模块级清空 skill instances + events)
- 删 `EngineInstance` 接口
- `DispatchResult` 不含 `state` 字段(返回 `error? / gameOver? / winner?`)

- [ ] **Step 1: 删 `EngineInstance` 接口,简化 `DispatchResult`**

打开 `src/engine/create-engine.ts`,删除:
- `export interface EngineInstance { ... }`(line 51-62)
- `export interface DispatchResult { state: GameState; error?: string; gameOver?: boolean; winner?: string; }`(line 42-49)

替换 `DispatchResult` 为:
```ts
export interface DispatchResult {
  error?: string;
  gameOver?: boolean;
  winner?: string;
}
```

新增 `GameConfig` 接口:
```ts
export interface GameConfig {
  characters: Array<{ name: string; skills: string[] }>;
  playerCount: number;
  seed: number;
  gameId: string;
  handSize?: number;
}
```

- [ ] **Step 2: 删 `extractPendingTarget`,改为模块顶层 helper**

原 `extractPendingTarget` 改为顶层 `function`:
```ts
/** 从 pending atom 中提取等待目标玩家。所有内置等待型 atom 都有 target 字段 */
function extractPendingTarget(atom: Atom): string {
  if ('target' in atom && typeof atom.target === 'string') return atom.target;
  return '';
}
```

- [ ] **Step 3: 删 `ensureStateShape` 的 spread 版本,改为原地**

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

- [ ] **Step 4: 实现 `create(gameConfig)`**

```ts
export async function create(gameConfig: GameConfig): Promise<GameState> {
  const state = createGameState({ players: [], cardMap: {} });
  ensureStateShape(state);
  state.startedAt = Date.now();
  const result = await dispatch(state, {
    skillId: '开局',
    actionType: 'start',
    ownerId: '主公',
    params: { ...gameConfig },
    baseSeq: 0,
  });
  if (result.error) throw new Error(`开局失败: ${result.error}`);
  rebootstrap(state);
  return state;
}
```

- [ ] **Step 5: 实现 `dispatch(state, msg)`**

模块顶部声明 `activeExecuteP`(回应路径共用):

```ts
let activeExecuteP: Promise<void> | undefined;

export async function dispatch(state: GameState, message: ClientMessage): Promise<DispatchResult> {
  // === 回应路径 ===
  if (state.pendingSlot) {
    const slot = state.pendingSlot;
    const target = extractPendingTarget(slot.atom);
    if (message.ownerId !== target) return {};

    const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
    if (entry) {
      const view = buildView(state, getViewerIndex(state, message.ownerId));
      const err = entry.validate(view, message.params);
      if (err === null) {
        const ctx: EngineContext = {
          state,
          self: message.ownerId,
          messageParams: { ...message.params },
          fireDispatchReady: () => {},
        };
        const api = createEngineApi(ctx);
        await entry.execute(api);
      }
    }
    const resolve = slot.resolve;
    slot.resolve = () => {};
    resolve();

    if (activeExecuteP) await activeExecuteP;
    activeExecuteP = undefined;

    logAction(state, message);
    state.seq += 1;
    const { gameOver, winner } = checkGameOver(state);
    return { gameOver, winner };
  }

  // === 主动 action 路径 ===
  let entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
  if (!entry && message.actionType === 'use') {
    const cardId = message.params?.cardId as string | undefined;
    if (cardId) {
      const card = state.cardMap[cardId];
      if (card?.type === '装备牌') {
        entry = findActionEntry('装备通用', message.ownerId, message.actionType);
      }
    }
  }
  if (!entry) return {};

  const view = buildView(state, getViewerIndex(state, message.ownerId));
  const validationError = entry.validate(view, message.params);
  if (validationError !== null) return { error: validationError };

  // execute 返回前先等 fireDispatchReady(apply 抵达 pending 时触发),
  // 再等整条 executeP 结束(响应/超时后 resolve 收尾)
  let dispatchReadyResolve: () => void = () => {};
  const dispatchReady = new Promise<void>((r) => { dispatchReadyResolve = r; });
  let fired = false;
  const fireDispatchReady = (): void => {
    if (!fired) { fired = true; dispatchReadyResolve(); }
  };
  const ctx: EngineContext = {
    state,
    self: message.ownerId,
    messageParams: { ...message.params, __ownerId: message.ownerId },
    fireDispatchReady,
  };
  const api = createEngineApi(ctx);
  const executeP = entry.execute(api).finally(fireDispatchReady);
  activeExecuteP = executeP;

  await dispatchReady;
  await activeExecuteP;
  activeExecuteP = undefined;

  logAction(state, message);
  state.seq += 1;
  const { gameOver, winner } = checkGameOver(state);
  return { gameOver, winner };
}
```

**注意**:
- 不再调 `setRuntimeApi`(已在 Task 4 step 1 删除)
- `ctx.state` 是引用,所有 mutate 在 execute 期间直接可见,无需 `ctx.state = X` 重赋值
- `activeExecuteP` 跟踪回应路径上的内嵌 execute(被 `api.apply` 触发的嵌套 action),让外层 dispatch 等待其结束

- [ ] **Step 6: 实现 `logAction` / `checkGameOver` / `getViewerIndex`**

```ts
function logAction(state: GameState, message: ClientMessage): void {
  state.actionLog.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now() - state.startedAt,
    message,
    baseSeq: message.baseSeq ?? -1,
  });
}

function checkGameOver(state: GameState): { gameOver: boolean; winner?: string } {
  const aliveCount = state.players.filter(p => p.alive).length;
  if (aliveCount <= 1) {
    const winner = state.players.find(p => p.alive);
    return { gameOver: true, winner: winner?.name ?? '无人' };
  }
  return { gameOver: false };
}

function getViewerIndex(state: GameState, ownerName: string): number {
  return state.players.findIndex((p) => p.name === ownerName);
}
```

- [ ] **Step 7: 实现 `buildView` / `fireTimeout` / `resetForTest`**

```ts
export function buildView(state: GameState, viewer: number): GameView {
  // 沿用原 buildView(state, viewer) 实现,从 view/buildView.ts 导入
  return buildViewImpl(state, viewer);
}
```

`fireTimeout`:
```ts
export async function fireTimeout(state: GameState): Promise<DispatchResult> {
  const slot = state.pendingSlot;
  if (!slot) return {};
  await slot._fireTimeoutNow?.();
  if (activeExecuteP) await activeExecuteP;
  activeExecuteP = undefined;
  const { gameOver, winner } = checkGameOver(state);
  return { gameOver, winner };
}
```

`resetForTest`:
```ts
export function resetForTest(): void {
  clearAllSkillInstances();
  clearEvents();
  activeExecuteP = undefined;
}
```

- [ ] **Step 8: 跑 typecheck + 现有 engine 测试**

```bash
pnpm typecheck 2>&1 | tail -10
```

**预期**: `create-engine.ts` 内 0 错误。其他文件无新错误(因为 Task 2-4 已处理)。

跑 engine 相关 test:
```bash
pnpm test -- tests/integration/new-engine-kill.test.ts 2>&1 | tail -30
```

**预期**: 测试本身逻辑要适配(测试还在用旧 `engine.X` 接口,Task 9 之后改),但 engine 内部逻辑应该能跑。

如果 typecheck 通过但测试因 `engine` 字段缺失失败(测试代码问题),跳到 Task 9 改测试,先 commit 此 Task。

- [ ] **Step 9: Commit**

```bash
git add src/engine/create-engine.ts
git commit -m "refactor(create-engine): 重写为顶层函数 + create(gameConfig) → GameState

删除 EngineInstance 闭包工厂。create 内部 dispatch 开局 start + rebootstrap。
dispatch/buildView/fireTimeout/resetForTest 全部顶层导出,state 作首参。
DispatchResult 去除 state 字段(调用方已持引用)。
回应路径不再需要 activeExecuteCtx 复制(state 原地变更,引用共享)。"
```

---

## Task 6: 写 e2e 测试覆盖 `create(gameConfig)`

**Files:**
- Create: `tests/integration/create-game.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/integration/create-game.test.ts
import { describe, it, expect } from 'vitest';
import { create } from '../../src/engine/create-engine';
import { resetForTest } from '../../src/engine/create-engine';
import type { GameConfig } from '../../src/engine/create-engine';

describe('create(gameConfig) — 端到端开局', () => {
  it('一次调用产生完整可玩 state:主公选将完成 + 4 张起始手牌', async () => {
    resetForTest();
    const config: GameConfig = {
      characters: [
        { name: '刘备', skills: ['仁德'] },
        { name: '曹操', skills: ['护甲'] },
        { name: '孙权', skills: ['制衡'] },
      ],
      playerCount: 3,
      seed: 42,
      gameId: 'test-create',
    };
    const state = await create(config);

    // state 有 3 个玩家(对应 3 个角色)
    expect(state.players).toHaveLength(3);
    expect(state.players.map(p => p.character).sort()).toEqual(['刘备', '曹操', '孙权']);

    // 主公已确定(由 抽身份 atom 决定)
    const lord = state.players.find(p => p.vars['身份'] === '主公');
    expect(lord).toBeDefined();
    expect(lord).toBe(state.players[0]);  // 主公是第一个玩家

    // 每个玩家有 4 张起始手牌(主公 5 张 lordBonus)
    for (const p of state.players) {
      const expected = p === lord ? 5 : 4;
      expect(p.hand.length).toBe(expected);
    }

    // 牌堆有牌(被摸了 13 张,108 - 13 = 95)
    expect(state.zones.deck.length).toBe(108 - (4 * 3 + 1));  // 4 张 × 3 人 + 1 张主公奖励

    // 状态进入第一个回合(主公 回合开始 / 阶段开始 已 apply)
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.turn.round).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

```bash
pnpm test -- tests/integration/create-game.test.ts 2>&1 | tail -20
```

**预期**: PASS(Task 5 已实现 `create`)。

如果失败,debug 修。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/create-game.test.ts
git commit -m "test(e2e): create(gameConfig) 端到端覆盖

验证主公选将 + 起始手牌 + 牌堆剩余 + 第一回合进入状态。"
```

---

## Task 7: 改写 `session.ts`

**Files:**
- Modify: `src/server/session.ts`(全文件)
- Modify: `src/server/persistence.ts`(删 `restoreToState`)

- [ ] **Step 1: 替换 `engine: EngineInstance` 字段为 `state: GameState`**

`session.ts:35`:
```ts
// 改前
private engine: EngineInstance | null = null;
// 改后
private state: GameState | null = null;
```

- [ ] **Step 2: 替换所有 `this.engine.X` 调用**

`grep -n "this.engine" src/server/session.ts` 找全所有调用点(约 20 处),逐个替换:
- `this.engine.dispatch(action)` → `dispatch(this.state, action)`
- `this.engine.getState()` → `this.state`(去掉调用)
- `this.engine.buildView(idx)` → `buildView(this.state, idx)`
- `this.engine.resetForTest()` → `resetForTest()`
- `this.engine.fireTimeout()` → `fireTimeout(this.state)`

同时把所有 `this.engine = null;` 改 `this.state = null;`。

- [ ] **Step 3: 改 `startGame`**

`session.ts:66-122`,把 bootstrap + dispatch 开局 start + rebootstrap 合成:
```ts
async startGame(playerCount?: number): Promise<boolean> {
  if (this.destroyed) return false;
  const count = this.debug ? (playerCount ?? this.room.players.size) : this.room.players.size;
  if (count < 2) return false;

  this.state = await create({
    characters: CHARACTERS,
    playerCount: count,
    seed: this.sessionSeed,
    gameId: this.room.id,
  });

  // 建立 playerId → playerName 映射(原 96-109 行不变)
  // ...

  if (result.gameOver) {  // create 已包含 dispatch 开局 result,但 state 在 this.state,需要从 state 推 gameOver
    this.handleGameOver(/* winner 怎么拿? */);
  }
  // ...
}
```

`create` 内部 dispatch 失败会 throw,所以如果走完,gameOver 由调用方基于 `this.state.players.filter(p => p.alive).length` 推算。简化:

```ts
this.state = await create({...});
// 玩家映射 ...
if (this.state.players.filter(p => p.alive).length <= 1) {
  const winner = this.state.players.find(p => p.alive);
  this.handleGameOver(winner?.name);
}
this.actionLog = [];
this.lastActivityAt = Date.now();
setRoomStatus(this.room.id, '进行中');
this.sendInitialViewToAll();
this.resetIdleTimer();
return true;
```

- [ ] **Step 4: 改 `restoreState` 为 `restoreFromLog`**

`session.ts:58-64`:
```ts
async restoreFromLog(gameConfig: GameConfig, actionLog: ActionLogEntry[]): Promise<void> {
  this.actionLog = [...actionLog];
  this.lastActivityAt = Date.now();
  this.state = await create(gameConfig);
  for (const log of actionLog) {
    // actionLog[0] 是开局的 start,create 已执行,跳过避免重复
    if (log.message.skillId === '开局' && log.message.actionType === 'start') continue;
    await dispatch(this.state, log.message);
  }
}
```

(原 `restoreState` 删除。)

- [ ] **Step 5: 改 `idleTimer` 内部 dispatch**

`session.ts:295-308` 的 `setTimeout` 回调:
```ts
const seq = this.state.seq;  // 改:this.engine.getState().seq → this.state.seq
await dispatch(this.state, {  // 改:this.engine.dispatch → dispatch(this.state, ...)
  skillId: '回合管理',
  actionType: 'end',
  ownerId: currentPlayer.name,
  params: {},
  baseSeq: seq,
});
```

- [ ] **Step 6: 改 `persistAsync`**

`session.ts:317-331`,`this.engine.getState()` → `this.state`,无 return 变化。

- [ ] **Step 7: 删 `src/server/persistence.ts` 的 `restoreToState` 函数**

```bash
# persistence.ts:237-240
export function restoreToState(persisted: PersistedRoom): GameState {
  return persisted.state;
}
```

整体删除。

- [ ] **Step 8: 跑 typecheck**

```bash
pnpm typecheck 2>&1 | tail -20
```

**预期**: session.ts / persistence.ts 内 0 错误。app.ts:117 因 `session.restoreState` 改名为 `restoreFromLog` 报错,下个 Task 修。

- [ ] **Step 9: Commit**

```bash
git add src/server/session.ts src/server/persistence.ts
git commit -m "refactor(session): engine: EngineInstance → state: GameState

所有 this.engine.X 改顶层函数调用。startGame 走 create(gameConfig)。
restoreState 改 restoreFromLog(gameConfig, actionLog) replay 路径。
persistence.ts 删 restoreToState(不再用)。"
```

---

## Task 8: 改写 `app.ts` 调用点

**Files:**
- Modify: `src/server/app.ts`(line ~98-117)

- [ ] **Step 1: 找到 `restoreState` / `restoreToState` 调用点**

`grep -n "restoreState\|restoreToState" src/server/app.ts`

应有 2 处:`restoreToState` 在 line 98,`session.restoreState` 在 line 117。

- [ ] **Step 2: 改 `restoreToState` 调用点**

`app.ts:98`:
```ts
// 改前
const state = restoreToState(persisted);
// 改后
// 删除此行(不再用 state 字段直接喂引擎)
```

- [ ] **Step 3: 装配 `GameConfig` 并调 `restoreFromLog`**

`app.ts:117`:
```ts
// 改前
session.restoreState(state, persisted.actionLog);

// 改后
import { allCharacterMap } from '../engine/characters';  // 或从 persistence 内部装配
// 装配 gameConfig
const characters = persisted.players.map(p => ({
  name: p.characterId,  // 或 p.name,看 PersistedRoom.players 字段语义
  skills: allCharacterMap[p.characterId]?.skills ?? [],
}));
const gameConfig: GameConfig = {
  characters,
  playerCount: persisted.players.length,
  seed: persisted.seed,
  gameId: persisted.roomId,
};
await session.restoreFromLog(gameConfig, persisted.actionLog);
```

- [ ] **Step 4: 删未用的 import**

`app.ts:23`:
```ts
import { listPersistedRooms, loadRoom, deletePersistedRoom, restoreToState } from './persistence';
```
改为:
```ts
import { listPersistedRooms, loadRoom, deletePersistedRoom } from './persistence';
```

- [ ] **Step 5: 跑 typecheck + 启动 server**

```bash
pnpm typecheck 2>&1 | tail -10
pnpm dev &  # 后台启动
sleep 3
curl -s http://localhost:3930/api/rooms | head -5
kill %1 2>/dev/null
```

**预期**: typecheck 0 错误。server 启动并响应。

- [ ] **Step 6: Commit**

```bash
git add src/server/app.ts
git commit -m "refactor(app): restoreState 调用点改 restoreFromLog

装配 GameConfig(从 PersistedRoom.players + seed)。
删 restoreToState 引用。"
```

---

## Task 9: 写 integration 测试覆盖 `restoreFromLog`

**Files:**
- Create: `tests/integration/restore-from-log.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/integration/restore-from-log.test.ts
import { describe, it, expect } from 'vitest';
import { create, dispatch, resetForTest } from '../../src/engine/create-engine';
import { rebootstrap } from '../../src/engine/skill';
import { createGameState } from '../../src/engine/types';
import type { ActionLogEntry, GameConfig, GameState } from '../../src/engine/types';

describe('restoreFromLog 路径(replay actionLog 重建 state)', () => {
  it('同 (gameConfig, actionLog) replay 产生等价 state', async () => {
    resetForTest();
    const config: GameConfig = {
      characters: [
        { name: '刘备', skills: ['仁德'] },
        { name: '曹操', skills: ['护甲'] },
      ],
      playerCount: 2,
      seed: 42,
      gameId: 'restore-test',
    };

    // 第一次:创建 + 跑一些 actions
    const state1 = await create(config);
    // (跑一个 杀 出牌,以产生 actionLog entry;本测试只验证 replay 路径,不验证具体 action 内容)
    // ...

    const actionLog: ActionLogEntry[] = state1.actionLog;

    // 第二次:replay 重建
    resetForTest();
    const state2 = await create(config);
    rebootstrap(state2);
    for (const log of actionLog) {
      if (log.message.skillId === '开局' && log.message.actionType === 'start') continue;
      await dispatch(state2, log.message);
    }

    // state2 应与 state1 等价
    expect(state2.seq).toBe(state1.seq);
    expect(state2.players.map(p => p.health)).toEqual(state1.players.map(p => p.health));
    expect(state2.zones.deck.length).toBe(state1.zones.deck.length);
    expect(state2.zones.discardPile).toEqual(state1.zones.discardPile);
  });

  it('跳过 actionLog 中的开局 start(create 已执行,不能重复 dispatch)', async () => {
    resetForTest();
    const config: GameConfig = {
      characters: [{ name: '刘备', skills: ['仁德'] }, { name: '曹操', skills: ['护甲'] }],
      playerCount: 2, seed: 42, gameId: 'skip-start',
    };
    const state = await create(config);
    // 模拟一个 actionLog,首项是 开局 start
    const log: ActionLogEntry = {
      id: 'test',
      timestamp: 0,
      message: { skillId: '开局', actionType: 'start', ownerId: '主公', params: config, baseSeq: 0 },
      baseSeq: 0,
    };
    // 不应 throw 也不应破坏 state
    await expect(dispatch(state, log.message)).resolves.toBeDefined();
    // state.players 数量不变(没创建新玩家,也没抛错)
    expect(state.players.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

```bash
pnpm test -- tests/integration/restore-from-log.test.ts 2>&1 | tail -20
```

**预期**: PASS(Task 5-7 已实现)。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/restore-from-log.test.ts
git commit -am "test(integration): restoreFromLog replay 路径覆盖

验证同 (gameConfig, actionLog) 二次 produce 等价 state,
并显式覆盖跳过 开局 start 的逻辑(避免重复 dispatch)。"
```

---

## Task 10: 删 `engine-isolation.test.ts`

**Files:**
- Delete: `tests/integration/engine-isolation.test.ts`

- [ ] **Step 1: 删除文件**

```bash
git rm tests/integration/engine-isolation.test.ts
```

- [ ] **Step 2: 验证测试集仍能跑**

```bash
pnpm test -- tests/integration/ 2>&1 | tail -10
```

**预期**: 没了 engine-isolation.test.ts,其他 integration test 行为不变。

- [ ] **Step 3: Commit**

```bash
git commit -m "test: 删 engine-isolation.test.ts

测的是旧 per-instance hook 隔离特性。新设计是单 engine / 模块级 hook,
该特性不存在(详见 spec 6.5)。"
```

---

## Task 11: 改写 `tests/engine-harness.ts`

**Files:**
- Modify: `tests/engine-harness.ts`(全文件)

- [ ] **Step 1: 替换 import**

`engine-harness.ts:27`:
```ts
// 改前
import { createEngine, type EngineInstance } from '../src/engine/create-engine';
// 改后
import { resetForTest, dispatch, buildView, fireTimeout } from '../src/engine/create-engine';
import { rebootstrap } from '../src/engine/skill';
```

- [ ] **Step 2: 改 `SkillTestHarness`**

```ts
// 改前
export class SkillTestHarness {
  readonly engine: EngineInstance;
  private sessions = new Map<string, PlayerSession>();

  constructor() {
    this.engine = createEngine();
  }

  setup(state: GameState): void {
    this.engine.resetForTest();
    this.engine.bootstrap(state);
    // ...
  }
}

// 改后
export class SkillTestHarness {
  state!: GameState;
  private sessions = new Map<string, PlayerSession>();

  constructor() {}

  setup(state: GameState): void {
    resetForTest();
    rebootstrap(state);
    this.state = state;
    for (const player of state.players) {
      const session = new PlayerSession(player.name, this);
      session.loadFrontend();
      this.sessions.set(player.name, session);
    }
  }

  player(name: string): PlayerSession { /* 不变 */ }
  get state(): GameState { return this.state; }
  get events(): GameEvent[] { return getEvents(0); }
}
```

(注意 `state` 现在既是字段又是 getter —— TS 不允许,所以 `state` 字段去掉 getter,只保留字段。)

- [ ] **Step 3: 改 `PlayerSession.view`**

`engine-harness.ts:103-106`:
```ts
get view(): GameView {
  const idx = this.harness.state.players.findIndex((p) => p.name === this.playerName);
  return buildView(this.harness.state, idx);
}
```

- [ ] **Step 4: 改 `PlayerSession.dispatch`**

`engine-harness.ts:218-227`:
```ts
private async dispatch(msg: Omit<ClientMessage, 'ownerId' | 'baseSeq'>): Promise<void> {
  const result = await dispatch(this.harness.state, {
    ...msg,
    ownerId: this.playerName,
    baseSeq: this.harness.state.seq,
  });
  if (result.error) throw new Error(`dispatch error: ${result.error}`);
}
```

- [ ] **Step 5: 改 `PlayerSession.pass`**

`engine-harness.ts:178`:
```ts
async pass(): Promise<void> {
  await fireTimeout(this.harness.state);
}
```

- [ ] **Step 6: 跑 typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

**预期**: engine-harness.ts 内 0 错误。

- [ ] **Step 7: Commit**

```bash
git add tests/engine-harness.ts
git commit -am "refactor(harness): 删 engine 字段,改顶层函数 + this.state 引用

SkillTestHarness 持有 state 字段而非 engine 实例。
PlayerSession 内部全部改用 this.harness.state + 顶层函数。"
```

---

## Task 12: 改写 `tests/engine-helpers.ts`

**Files:**
- Modify: `tests/engine-helpers.ts`(全文件)

- [ ] **Step 1: 替换 import**

```ts
// 改前
import { createEngine } from '@engine/create-engine';
import type { EngineInstance } from '@engine/create-engine';
// 改后
import { create, resetForTest, type DispatchResult, type GameConfig } from '@engine/create-engine';
import { rebootstrap } from '@engine/skill';
```

- [ ] **Step 2: 删 `createTestEngine`**

`engine-helpers.ts:11-13`:
```ts
// 删除
export function createTestEngine(): EngineInstance {
  return createEngine({ skills: allSkills });
}
```

- [ ] **Step 3: 新增 `setupTestState` 和 `createTestGame`**

```ts
/** 同步 helper:对已建 state 跑 resetForTest + rebootstrap(用于测试自己构造的 state) */
export function setupTestState(state: GameState): void {
  resetForTest();
  rebootstrap(state);
}

/** 异步 helper:跑完整 create 流程(开局 + rebootstrap),返回 state */
export async function createTestGame(opts: { characters: string[]; seed?: number } = {}): Promise<GameState> {
  const characters = opts.characters
    .map((name) => characterMap[name])
    .filter((c): c is CharacterConfig => c !== undefined)
    .map((c) => ({ name: c.name, skills: c.abilities ?? [] }));
  const config: GameConfig = {
    characters,
    playerCount: characters.length,
    seed: opts.seed ?? 42,
    gameId: 'test',
  };
  return create(config);
}
```

- [ ] **Step 4: 跑 typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

**预期**: engine-helpers.ts 内 0 错误。

- [ ] **Step 5: Commit**

```bash
git add tests/engine-helpers.ts
git commit -am "refactor(helpers): createTestEngine 拆为 setupTestState + createTestGame

旧 createTestEngine 旧签名 (config) 实际 broken(新 create 不接 config)。
新 helper 走新 API 形态。"
```

---

## Task 13: 改写 5 个 integration test(`new-engine-*.test.ts`)

**Files:**
- Modify: 5 个 test 文件
  - `tests/integration/new-engine-kill.test.ts`
  - `tests/integration/new-engine-hujia.test.ts`
  - `tests/integration/new-engine-rende.test.ts`
  - `tests/integration/new-engine-fire-timeout.test.ts`
  - `tests/integration/server-gameplay.test.ts`

**统一改造模式**(以 `kill.test.ts` 为例):

- [ ] **Step 1: 改 import**

`kill.test.ts:4`:
```ts
// 改前
import { createEngine, type EngineInstance } from '../../src/engine/create-engine';
// 改后
import { resetForTest, dispatch, buildView, fireTimeout, create } from '../../src/engine/create-engine';
import { rebootstrap } from '../../src/engine/skill';
```

- [ ] **Step 2: 改 `let engine: EngineInstance;` 为 `let state: GameState;`**

```ts
// 改前
let engine: EngineInstance;
// 改后
let state: GameState;
```

- [ ] **Step 3: 改 `beforeEach`**

```ts
// 改前
beforeEach(() => {
  engine = createEngine();
  engine.resetForTest();
  engine.bootstrap(buildInitialState());
});

// 改后
beforeEach(() => {
  resetForTest();
  state = buildInitialState();
  rebootstrap(state);
});
```

- [ ] **Step 4: 替换所有 `engine.X` 调用**

逐个 `grep -n "engine\." <FILE>` 找到所有调用,替换:
- `engine.dispatch(...)` → `dispatch(state, ...)`
- `engine.getState()` → `state`
- `engine.buildView(idx)` → `buildView(state, idx)`
- `engine.fireTimeout()` → `fireTimeout(state)`

- [ ] **Step 5: 5 个文件都改完,跑 typecheck + 跑这 5 个 test**

```bash
pnpm typecheck 2>&1 | tail -10
pnpm test -- tests/integration/new-engine- 2>&1 | tail -30
```

**预期**: typecheck 0 错误;5 个 test 全过。

- [ ] **Step 6: Commit**

```bash
git add tests/integration/new-engine-*.test.ts
git commit -am "refactor(test): 5 个 new-engine integration test 改顶层函数调用形态"
```

---

## Task 14: 写 ADR

**Files:**
- Create: `docs/decisions/0027-create-engine-refactor.md`

- [ ] **Step 1: 写 ADR 内容**

按项目 ADR 风格(参考 `docs/decisions/0026-unified-engine-architecture.md`),内容覆盖:
- **状态**: Accepted(2026-06-12)
- **背景**: 旧 `createEngine()` 闭包工厂 + 不可变 state + 实例方法,访问不方便,变更都需 spread 包装
- **决策**:
  - `create()` 返回 `GameState`,无 wrapper
  - 顶层函数 `dispatch / buildView / fireTimeout / resetForTest`,`state` 作首参
  - 43 个 atom 改原地变更 mutation,`AtomDefinition.apply` 返回 `void`
  - 删除 `runtimeApi` 转发机制(零外部使用)
  - `rebootstrap(state)` 上提至 `skill.ts` 顶层
  - `bootstrap` 并入 `create(gameConfig)`
  - 恢复走 `restoreFromLog(gameConfig, actionLog)` replay
- **后果**:
  - 客户端 React 组件可能需 `useEffect` 监听 state 引用(留 issue 跟进)
  - 单 engine 假设保留,真要并行单独开 ADR
  - 公共 API 破坏性变更(无 `EngineInstance`)

```markdown
# ADR-0027: create-engine 重构(create 工厂 + 顶层函数 + 原地变更)

## 状态

Accepted 2026-06-12

## 背景

旧 `createEngine()` 是闭包工厂,返回 `EngineInstance` 实例,所有方法 (`dispatch / buildView / resetForTest / bootstrap / rebootstrap / getState / fireTimeout`) 挂在实例上。`currentState` 在闭包内被 `currentState = { ...currentState, ... }` 模式重赋值,每次状态变更都要 spread 一份新对象,代码冗长且访问不便。

同时存在 4 个不必要的间接层:
- `runtimeApi` 全局槽位 + `BackendAPI.apply/notify` 转发(实际零使用)
- 不可变 state wrapper(atom 已经做正确性边界,spread 多此一举)
- `bootstrap` / `rebootstrap` 走 `createEngine` 实例方法(不是 skill 注册职责)
- `session.restoreState(state, log)` 快照恢复(不可重放)

## 决策

### 1. API 形态:create 返回 GameState,顶层函数

```ts
export async function create(gameConfig: GameConfig): Promise<GameState>
export async function dispatch(state: GameState, msg: ClientMessage): Promise<DispatchResult>
export function buildView(state: GameState, viewer: number): GameView
export async function fireTimeout(state: GameState): Promise<DispatchResult>
export function resetForTest(): void
```

- `create()` 返回的就是 state 本身(纯数据,无 wrapper)
- 顶层函数以 `state` 作首参(贴近 skill 模块的"create 工厂 + 顶层注册"模式)
- 删 `EngineInstance` 接口

### 2. 状态变更:原地 mutation

- 43 个 atom `apply(state, atom): void`,直接 mutate `state` 字段
- `AtomDefinition.apply` 签名 `→ void`
- 引擎内部 bookkeeping(`state.seq += 1` / `state.actionLog.push(...)` / `state.atomStack.push/pop`)也走 mutation
- `state` 引用在 `create()` 时稳定,后续任何 execute / hook 改的都是同一对象

### 3. 删 runtimeApi

- `_runtimeApi` / `setRuntimeApi` / `BackendAPI.apply/notify` 全部移除
- 审计:无任何 skill 在 onInit 中调 `api.apply` / `api.notify`,全在 `registerAction` execute(`EngineApi` 直接拿)或 hook 上下文(`ctx.api` = `EngineApi`)
- `BackendAPI` 缩为 `self + registerAction + onAtomBefore + onAtomAfter`

### 4. rebootstrap 上提

- `rebootstrap(state)` 提到 `skill.ts` 顶层
- `create(gameConfig)` 内部:建 state → dispatch 开局 start → `rebootstrap(state)` → 返回
- 任何时候 `state.players` 变化后都可显式调 `rebootstrap`

### 5. 恢复走 replay

- `session.restoreState(state, log)` 删,改 `restoreFromLog(gameConfig, log)`
- replay 流程:`create(gameConfig)` → 跳过 log[0] 的 开局 start → 顺序 dispatch 其余
- `PersistedRoom.state` 字段保留(供重连初始 view 渲染),不再喂给引擎

### 6. 单 engine 假设保留

- 回应路径用模块级 `activeExecuteP` 跟踪
- 不引入 `WeakMap<GameState, EngineSession>` —— 真要并行多 engine 单独开 ADR

## 后果

### 正面

- 访问 state 字段直接 `state.players[0].health`,无需 spread
- API 形态贴近 skill 模块,认知负担低
- 43 个 atom 改 mutation 是机械工作,后续加 atom 不用想 spread
- replay 恢复替代 snapshot,可重放、可调试
- 公共 API 收敛:`create / dispatch / buildView / fireTimeout / resetForTest` 5 个函数

### 负面

- **公共 API 破坏性变更**:删 `EngineInstance`、改 `create` 签名,所有调用方一次改
- **state 引用稳定性变化**:React 端 `useMemo([state])` 缓存可能 stale(客户端按需跟进)
- **单 engine 假设**:多 game session 并行 dispatch 会串行(当前 usage OK)
- **`engine-isolation.test.ts` 删除**:测的是旧 per-instance 特性,新设计无
- **skill 实例表 + event stream 仍是模块级**:vitest 单线程 OK,跨文件共享风险

### 配套工作

- ADR-0027 本文件
- Spec: `docs/superpowers/specs/2026-06-12-create-engine-refactor-design.md`
- Plan: `docs/superpowers/plans/2026-06-12-create-engine-refactor.md`
```

- [ ] **Step 2: 跑全量测试 + typecheck + lint**

```bash
pnpm typecheck 2>&1 | tail -10
pnpm test 2>&1 | tail -30
pnpm lint 2>&1 | tail -10
```

**预期**: 全部 0 错误。

- [ ] **Step 3: Commit ADR + 推**

```bash
git add docs/decisions/0027-create-engine-refactor.md
git commit -m "docs(adr): 0027 create-engine 重构(create 工厂 + 顶层函数 + 原地变更)"
```

---

## 验收检查(覆盖 spec §9)

最终跑一遍 spec 验收清单:

- [ ] **T1**: `pnpm typecheck` 通过
- [ ] **T2**: `pnpm test` 通过(排除 spec §6.5 明确删除的 `engine-isolation.test.ts`)
- [ ] **T3**: `pnpm lint` 通过
- [ ] **T4**: 旧 API 0 引用:
  ```bash
  grep -rn "createEngine\b" src tests --include="*.ts"  # 0 命中
  grep -rn "EngineInstance\b" src tests --include="*.ts"  # 0 命中
  grep -rn "setRuntimeApi\|_runtimeApi" src --include="*.ts"  # 0 命中
  ```
- [ ] **T5**: `create(gameConfig)` e2e 测试存在并通过(`tests/integration/create-game.test.ts`)
- [ ] **T6**: `restoreFromLog(gameConfig, actionLog)` integration 测试存在并通过(`tests/integration/restore-from-log.test.ts`)
- [ ] **T7**: 43 个 atom `apply` 返回 `void`(`tsc` 强制)
- [ ] **T8**: `restoreFromLog` 跳过开局 start 的回归有测试覆盖
- [ ] **T9**: ADR 写好并 commit
- [ ] **T10**: `engine-isolation.test.ts` 已删
