# ADR 0028 — engine-api 顶层化:无 EngineApi 闭包,无 BackendAPI 回调参数

**状态**: 已采纳

**前置依赖**: ADR 0012、ADR 0013、ADR 0026、ADR 0027

## 背景

ADR 0027 把 `create-engine` 拆成顶层函数(state 通过参数传)之后,引擎入口的"无闭包"化基本完成。但引擎内部给 skill 用的"操作 gameState 的 API"还停留在闭包对象模式:

- **`BackendAPI`** 闭包对象 —— 传给 `onInit(skill, api: BackendAPI)`,技能用 `api.registerAction(...)`、`api.onAtomBefore(...)` 注册回调
- **`EngineApi`** 闭包对象 —— 传给 `async (api: EngineApi) => { ... }` 作为 execute 的入参,execute 用 `api.apply(...)`、`api.pushFrame(...)`、`api.popFrame()`、`api.self`、`api.params` 调引擎

这个模式积累出 ADR 0027 同样类型的问题:

### 1. 技能需要"两个状态源"

execute 拿到 `api: EngineApi` 但实际"state"藏在 `api.state` getter 后面;验证函数拿到 `view: GameView` 但"真实状态"在 `view.players[view.viewer]` 里。skill 文件到处是 `api.self` / `api.params` / `api.state` 这种"先取 state、再读字段"的两步式访问,业务原子(摸牌/弃置/造成伤害)被闭包字段访问挡在前面。

### 2. test-ability 差

写一个 skill 单元测试要先 mock 一个 BackendAPI(带 registerAction / onAtomBefore / registerSkill 全部接口),再 mock 一个 EngineApi(带 state / self / params / apply / pushFrame / popFrame / topFrame / notify),再 setUp/teardown 一套。fixture 工厂和单测体差不多长。

### 3. 跨 skill 隔离的隐性成本

BackendAPI 在 onInit 时调 `api.registerAction(...)`,这个 register 写进闭包内的全局表。如果有两个 onInit 实例(同 skill 出现在两个 player 上),旧的实现是"先 unregister 旧的,再 register 新的"——容易漏写 unregister,导致单测跑完一个玩家 instance 之后第二个玩家 instance 拿到旧的回调,行为不一致。

### 4. 闭包传值 vs 直接 import 的可读性差距

skill 文件用 `import { applyAtom, pushFrame, popFrame } from '../engine-api'` 直接调顶层函数,IDE 跳转、类型推断、tree-shaking 都比"拿到一个对象再翻属性"自然。

## 决策

### 决策 1:`engine-api.ts` 拆为顶层函数

`src/engine/engine-api.ts` 导出顶层函数,**state 永远是第一参数**:

```ts
export async function applyAtom(state: GameState, atom: Atom): Promise<void>;
export function pushFrame(state, skillId, from, params?): SettlementFrame;
export function popFrame(state: GameState): void;
export function topFrame(state: GameState): SettlementFrame | undefined;
export function dropAtom(state: GameState): void;
export function pushNotify(_state: GameState, event: NotifyEvent): void;
```

模块级单例(不接 state)用于 dispatch 提前返回信号:

```ts
let currentDispatchReady: () => void = () => {};
export function setDispatchReady(fn: () => void): void;
export function clearDispatchReady(): void;
```

`applyAtom` 实现完整管线:push to atomStack → before hooks(检查 drop) → validate → apply → emit event → after hooks → pop → pending slot(挂起并 `notifyDispatchReady()`)。

### 决策 2:`skill.ts` 新增模块级 register 函数

```ts
export function registerAction(
  skillId: string, ownerId: string, actionType: string,
  validate: (state, ownerId, params) => string | null,
  execute: (state, ownerId, params) => Promise<void>,
): () => void;

export function registerBeforeHook(
  skillId: string, ownerId: string, atomType: string,
  handler: (ctx: AtomBeforeContext) => Promise<void>,
): () => void;

export function registerAfterHook(...): () => void;
```

每个返回 `unregister` 闭包;onInit 拿到后挂到模块级表里,自然支持 rebootstrap 时的"先 unregister 旧再 register 新"。

### 决策 3:`ActionEntry` 和 hook 签名改为 `(state, ownerId, params)`,不接 api

```ts
interface ActionEntry {
  skillId: string;
  ownerId: string;
  actionType: string;
  validate: (state: GameState, ownerId: string, params: Record<string, Json>) => string | null;
  execute: (state: GameState, ownerId: string, params: Record<string, Json>) => Promise<void>;
}

interface AtomBeforeContext { state; atom; ownerId; frame; params; }
interface AtomAfterContext  { state; atom; ownerId; frame; params; }
```

execute body 内部:
- `await applyAtom(state, { type: '摸牌', player, count: 2 })` 替代 `await api.apply({...})`
- `pushFrame(state, '制衡', from, { ...params })` 替代 `api.pushFrame('制衡', from, {...})`
- `_ownerId` 替代 `api.self`(因为 ownerId 现在是参数)
- `params` 直接用(替代 `api.params`)

hook body 内部:
- `applyAtom(ctx.state, ...)` 替代 `ctx.api.apply(...)`
- `dropAtom(ctx.state)` 替代 `ctx.api.drop()`
- `ownerId`(onInit 闭包)替代 `api.self`(onInit 闭包)

### 决策 4:`create()` 把 gameConfig 存进 `state._gameConfig`,bootstrap 读它

```ts
export function create(config: GameConfig): GameState {
  // ... 同步建骨架 state ...
  (state as GameState & { _gameConfig?: GameConfig })._gameConfig = config;
  return state;
}

export async function bootstrap(state: GameState): Promise<void> {
  const config = (state as GameState & { _gameConfig?: GameConfig })._gameConfig!;
  // ... 跑开局 ...
}
```

`bootstrap(state, config)` 旧签名废除,调用方不用再"传两次"(create 一次、bootstrap 一次)同一份 config。

### 决策 5:开局 skill 走 backward-compat wrapper(故意保留)

`开局.ts` 是 system skill,不是玩家技能。它用旧 `EngineApi` 闭包注册 action。dispatch 检测 `entry.execute.length === 1`(旧 1-arg 签名)就用 `createEngineApi(state, ownerId, params)` 包装调用。

```ts
const executeP = entry.execute.length === 1
  ? (entry.execute as unknown as (api: EngineApi) => Promise<void>)(createEngineApi(state, message.ownerId, message.params))
  : entry.execute(state, message.ownerId, message.params);
```

这样 `开局.ts` 可以保持原状(后续 stage B 再改),不会因为类型不匹配阻塞本次重构。

## 影响

### 改动的文件

- `src/engine/engine-api.ts` —— 重写,顶层函数化
- `src/engine/skill.ts` —— 新增 `registerAction` / `registerBeforeHook` / `registerAfterHook`
- `src/engine/create-engine.ts` —— `bootstrap` 签名改;`dispatch` 改用新 execute 签名 + 兼容旧 1-arg
- `src/engine/types.ts` —— `ActionEntry` / hook context 签名改;`EngineApi` 保留(仅作兼容 wrapper 类型)
- 35 个 `src/engine/skills/*.ts` 全部迁移
- `tests/engine-helpers.ts` / `tests/integration/create-game.test.ts` / `tests/integration/restore-from-log.test.ts` / `src/server/session.ts` —— `bootstrap(state, config)` → `bootstrap(state)`

### 收益

1. **skill 文件可读性大幅提升**:execute body 不再"先取 state、再读字段"的两步式访问,直接 `applyAtom(state, ...)` 一气呵成。
2. **测试 fixture 简化**:不再需要 mock BackendAPI / EngineApi 对象,直接传 state 调顶层函数。
3. **跨 skill 隔离更稳**:register 函数返回 unregister 闭包,onInit 末尾自然可以挂上"rebootstrap 时先清理"的逻辑。
4. **tree-shaking 友好**:顶层函数能被工具识别并剪除未使用的(以前整闭包可能因为某个字段被引用而保留)。

### 风险

- `开局.ts` 走旧 `EngineApi` 包装是技术债,未来需要 stage B 统一改。
- `entry.execute.length === 1` 检测依赖 Function.length,对 arrow function 不可靠(arrow with default args 行为不同)。当前 `开局.ts` 是普通 `async (api) => {...}`,Function.length === 1,安全。如果将来有人写 `async (api, _opts = {}) => {...}` 会变成 2,触发误判。

## 后续

- stage B:把 `开局.ts` 改用新模式,移除 `EngineApi` wrapper
- stage B:把 `EngineApi` / `BackendAPI` 类型从 `types.ts` 删除
- stage C:dispatch 的 arity 判断换成显式标记(`entry.legacy: boolean`)
