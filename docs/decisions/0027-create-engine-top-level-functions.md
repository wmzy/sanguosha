# ADR 0027 — create-engine 重构：顶层函数 + state 原地变更

**状态**: 已采纳

**前置依赖**: ADR 0012、ADR 0013、ADR 0026

## 背景

旧 `createEngine()` 是闭包工厂 —— 调用一次返回一个新 `EngineInstance`，所有引擎状态（activeExecuteP、action 注册表、hook 注册表、skill 实例表）藏在闭包里。`dispatch` / `buildView` / `rebootstrap` / `getState` 都是 `EngineInstance` 上的方法。这种模式积累出几个问题：

### 1. 多实例隔离成本高

测试同时跑两个独立游戏（replay + 实际执行对比）很常见，但旧 API 强制两个闭包各自维护一份全局表（actions / hooks / instances），谁也碰不到谁；只要 reset 一份，另一份就废。`engine-isolation.test.ts` 就是这个痛点的活化石 —— 最后被删掉了。

### 2. 开局 skill 跟 BackendAPI 强耦合

旧 `开局.onInit(skill, api: BackendAPI)` 走 `api.registerAction(entry)` 把开局流程挂进 action 表。但开局的"玩家"是"主公"这个虚拟身份，跟 BackendAPI 提供的"当前 self"语义对不上；`BackendAPI` 又携带 `_runtimeApi` 之类的 engine-私有字段，开局不得不学着普通技能的样子去申请一个 `api.runtimeApi`，把"系统一次性 bootstrap"硬塞进了"玩家技能实例"模型。

### 3. restore 路径的内存状态丢失问题

旧 `restoreFromLog` 反序列化得到 state 后，还得 `createEngine()` 起一个闭包、调一次 `bootstrap`，dispatch 一条 `start` 让 `开局` 跑过完整流程。原 ADR 据此认为“日志里这些动作都已记录，重跑既慢又可能 seed 不一致”，从而得出“restore 不应调 bootstrap”的结论——**该结论已被推翻**（见决策 7 修订）。真正的问题是：JSON 快照丢失了所有不可序列化的运行时内存状态（skill 实例、全局 hooks、respond action、pending slot 的函数/定时器），恢复时必须重建这些，而 `bootstrap` 正是重建它们的唯一入口。确定性 RNG（`config.seed = state.rngSeed`）保证重跑结果一致。

### 4. dispatch 阻塞 executeP 整段

旧 `dispatch` 在主动 action 路径上 `await activeExecuteP` 等整条 execute 完成。但 execute 经常在 `pushFrame` 一个 pending atom 后挂起，等客户端回应；这时 dispatch 仍要阻塞到 fireTimeout 或回应抵达才返回，主动方（client ws handler）就被无意义地挂着 5 秒。

### 5. state 不可变但访问不方便

旧 `GameState` 走 immutable 引用替换，但引擎内部 90% 的更新其实都是 `atom.apply(state, args)` 的原地变更（ADR 0012 后已经是 void 返回）。`createGameState` 的"返回新对象"语义在测试 fixture 里反复构造、剥皮、换 cardMap —— 不可变只是给 session 日志 snapshot 用的，对引擎内部是负担。

## 决策

### 决策 1：导出顶层函数，不再有 EngineInstance 类

`src/engine/create-engine.ts` 改为导出顶层函数，**所有引擎状态显式通过参数传**：

```ts
export function create(gameConfig: GameConfig): GameState;          // 同步
export async function bootstrap(state: GameState, gameConfig: GameConfig): Promise<void>;
export async function dispatch(state: GameState, message: ClientMessage): Promise<DispatchResult>;
export function buildView(state: GameState, viewer: number): GameView;
export function rebootstrap(state: GameState): void;
export async function fireTimeout(state: GameState): Promise<DispatchResult>;
export function resetForTest(): void;
```

调用方（`src/server/session.ts`）：

```ts
// 旧
this.engine = createEngine();
this.engine.bootstrap(config);
this.engine.dispatch(msg);
this.engine.buildView(idx);
this.engine.getState();

// 新
this.state = create(config);
await bootstrap(this.state, config);
await dispatch(this.state, msg);
buildView(this.state, idx);
// this.state 直接就是 state,不用 getState()
```

`EngineInstance` 类型完全删除。

### 决策 2：`create()` 同步 + `bootstrap()` 异步

`create(config)` 同步：建 `playerCount` 个空 player 槽位，初始化 state shape（`cardMap`, `zones`, `atomStack`, `pendingSlot=null`, `seq=0`, `actionLog=[]`）。**不触发任何 dispatch**。

`bootstrap(state, config)` 异步：
1. 动态 `await import('./skills/开局')` 加载开局模块
2. 调 `开局.onInit(syntheticSkill, state)` 注册 `start` action entry
3. `await dispatch(state, { skillId:'开局', actionType:'start', ownerId:'主公', params: config })` 跑完整开局
4. `skillRebootstrap(state)` 给每个 player 的 skills 注册实例

**为什么这样拆**：把状态构造（同步、无 IO）和开局执行（异步、动态 import、交互式选将可能挂起在 pending）分离。**两条路径都需要 bootstrap**（见决策 7 修订）：`startGame` 用 `create + bootstrap` 开局；`restoreState` 用 `create + bootstrap + restore` 先重建内存注册再重放 actionLog。解耦的价值在于让 session 能在 bootstrap 之前挂好 `onStateChange` 回调——交互式选将的 pending 需通过该回调广播给客户端。

### 决策 3：系统技能（如 `开局`）走特殊 `onInit(skill, state: GameState)` 接口

`开局` 不再是"主公"这个虚拟身份的技能实例，而是引擎 bootstrap 阶段**手动调用**的"系统能力"：

```ts
// src/engine/skills/开局.ts
export function onInit(_skill: Skill, _state: GameState): () => void {
  const entry: ActionEntry = {
    skillId: '开局',
    ownerId: '主公',
    actionType: 'start',
    validate: () => null,
    execute: async (api: EngineApi) => {
      // 抽身份 → 选将 → 洗牌 → 发牌 → 启动第一回合
      await api.apply({ type: '抽身份', playerCount, seed });
      await api.apply({ type: '选将', characters, seed });
      // ...
    },
  };
  registerActionEntry(entry);
  return () => unregisterActionEntry('开局', '主公', 'start');
}
```

**`onInit` 的第二参数是 `GameState` 而不是 `BackendAPI`**：开局不需要 BackendAPI 的 player self / messageParams，只读 state 注册 action entry 然后返回。这把"系统一次性 bootstrap"和"玩家技能实例"彻底解耦 —— 不需要 fake 一个 `_runtimeApi` 给开局面子。

**直接模块导入** `registerActionEntry` / `unregisterActionEntry` 从 `../skill`，不通过 `BackendAPI.registerAction` 包装 —— 因为这俩就是模块级 Map 的 setter，包装一层只会增加类型摩擦。

`SkillModule.onInit` 接口保留但**开局不走这条路径**（保留 `module_开局 = { createSkill }` 让 `getSkillModule('开局')` 还能查到，但 bootstrap 调的是顶层 `onInit` 导出）。

### 决策 4：state 原地变更，atom 是唯一写入边界

`GameState` 内的字段（`players`、`zones`、`actionLog`、`seq`、`pendingSlot`）全部走 in-place mutation —— 测试和技能代码都直接改 `state.players[i].hand.push(cardId)`，不再 spread 一个新对象。

但**写入语义只通过 atom**：`api.apply(atom)` 是引擎内部唯一允许 mutate state 的入口；atom 内部 42 个 apply 函数（ADR 0012 + 0026 迁移后）都是 void 返回，直接改 state。

`actionLog` 由 `dispatch` 自动 push，session 不直接 mutate `state.actionLog`；`state.seq` 由 `dispatch` 在 log 之后 `+= 1`，session 不直接改。

### 决策 5：模块级引擎状态保留

四个全局表保留在 `create-engine.ts` 模块作用域：
- `activeExecuteP: Promise<void> | undefined` —— 回应路径跟踪
- `actions` / `hooks` / `instances` —— 来自 `skill.ts` 的注册表

**进程内一次只跑一局游戏**是隐式约束（之前也是 —— `actions` Map 是模块级）；测试间用 `resetForTest()` 清空（`clearAllSkillInstances` + `clearEvents` + `activeExecuteP = undefined`）。

这种"模块全局 + reset"模式比"闭包多实例"简单得多。代价是：理论上可以在同一进程跑多局，但每局都得 `resetForTest()`。当前 server 架构（一个 session 一个 game）下完全够用。

### 决策 6：dispatch 在主动路径只 await 到 `fireDispatchReady`

```ts
// 主动 action 路径
const dispatchReady = new Promise<void>(r => { dispatchReadyResolve = r; });
let fired = false;
const fireDispatchReady = (): void => {
  if (!fired) { fired = true; dispatchReadyResolve(); }
};
const executeP = entry.execute(api).finally(fireDispatchReady);
activeExecuteP = executeP;
await dispatchReady;     // ← 不 await executeP
logAction(state, message);
state.seq += 1;
return { gameOver, winner };
```

**为什么**：execute 在 apply 到 pending atom 时会挂起等回应；这时主动方（`session.dispatchMessage`）不需要阻塞 —— `fireDispatchReady` 在 execute 抵达 pending 时触发（`engine-api.ts` 里 `pushFrame` pending 时同步调用），dispatch 立刻返回当前 state 给 caller。caller 收到 ws message 协议层 OK，可以继续收下一条 message；execute 的剩余部分在 `activeExecuteP` 上挂到回应或 `fireTimeout` 抵达才完成。

**测试用 `TestEngine.dispatchAndWait(state, msg)`**：在 `engine-helpers.ts` 里加一个 helper，主动 `await activeExecuteP`（如果存在）等 execute 真跑完，给单元测试一个"全跑完才看结果"的同步语义。

### 决策 7：restore 路径必须走 create + bootstrap + restore 重建运行时内存状态

> **修订（2026-08-07）**：原决策“restoreFromLog 不调 bootstrap，直接返回 persisted.state”被推翻。实践证明 JSON 反序列化得到的 state 快照**无法恢复程序内存状态**——下列运行时注册全部不可序列化（`sanitizeState` 持久化时已清除），无法从快照恢复：
> - skill 实例（`ActionEntry`：validate/execute/rollback 闭包）—— 由 `instantiateSkill` 注册到 state-bound 注册表
> - 系统规则全局 hooks（添加技能/移除技能/弃置/濒死检查）
> - 每个玩家的选将/弃牌 respond action entries（`registerSystemRespondActions`）
> - 酒的造成伤害 before-hook、延时锦囊判定/跳过 hooks、连环传导全局 after-hook
> - pending slot 的 resolve/pause/`_fireTimeoutNow`/setTimeout 定时器
>
> 游戏继续运行必须依赖这些内存注册（dispatch 查 action 表、applyAtom 跑 hooks、respond 定位 slot）。直接接管快照会导致这些全部缺失，游戏无法继续。

因此 restore 走完整三段式：

1. `persistence.ts::restoreFromLog(persisted)` 返回 JSON 快照 state（含 rngSeed/players/actionLog 等**可序列化**数据），供下游读取 seed/config。
2. `session.restoreState(state, actionLog)` 编排恢复：`create(config)` 造骨架 → `bootstrap(fresh, config)` 重建全部运行时内存注册（含开局 dispatch）→ `restore(fresh, config, actionLog)` 重放 actionLog 把状态推进到正确位置。
3. 确定性：`config.seed = state.rngSeed` 保证 bootstrap 重跑开局与原局一致；重放 actionLog 覆盖开局产生的状态，最终 state 与崩溃前一致。

**重放同步 + 超时推进（v3）**：dispatch 是 fire-and-forget，开局 execute 在后台异步推进，遇到等待型 atom（如选将询问）才创建 pending slot。`restore` 重放：
1. respond 类 action（选将/respond/skip/confirm）前 `waitForResponsiveSlot` 等目标 slot 出现；
2. dispatch 后 `waitForPendingOrDone` 等 execute 创建 pending 或跑完；
3. **isBlocking pending（询问闪/请求回应等）若不被剩余 actionLog respond，主动 `slot._fireTimeoutNow` fireTimeout 推进**——因为 fireTimeout（超时不出闪→扣血/弃牌/阶段结束）的副作用不在 actionLog（`_fireTimeoutNow` 调 `onTimeout` 内部的 applyAtom，不经过 dispatch/logAction），不主动 fireTimeout 则 pending 永不 resolve → 挂起 execute 堆积 → OOM。用 `slot._fireTimeoutNow`（只触发该 slot，不误伤出牌窗口等非阻塞 pending），之后 `waitForSeqStable` 等 execute resume 完成；
4. 重放完毕后 fireTimeout 残留 isBlocking pending。

> **OOM 根因（2026-08-07）**：旧实现的 `settleExecute`（等 seq 稳定）在 fire-and-forget execute 创建询问闪 pending 后过早返回（seq 暂时稳定），不 fireTimeout 该 pending → 每条出杀 use 创建一个永不 resolve 的询问闪 slot + 挂起的 execute promise → 中盘对局（大量出牌+超时）堆积 → 4GB 堆耗尽 → 服务启动崩溃。

## 后果

### 正面

- **EngineInstance 类型消失**：所有 API 签名显式带 state，调用方无法误用（"用错 engine" 类 bug 静态可查）
- **开局解耦 BackendAPI**：开局面板只读 state、注册 action entry、返回 unregister 函数；不申请任何 engine 私有 API
- **restore 路径确定性重放**：bootstrap 重建内存注册 + restore 重放 actionLog，保证崩溃前后状态一致（代价是重跑一次开局，~30 个 atom apply + skill 实例化；确定性由 rngSeed 保证）
- **dispatch 不再假阻塞**：主动方 await 到 `fireDispatchReady` 立刻返回，client ws 可以继续收 message；游戏内在 `activeExecuteP` 上异步推进
- **state 字段访问更顺手**：测试 fixture 和技能代码都可以直接改 `state.players[i].hand`，不再 spread 半天
- **引擎状态统一在模块级**：进程内一套注册表 + reset；不需要为多 engine 维护多份 Map

### 负面

- **进程级 reset**：`resetForTest()` 一次清空所有全局表，理论上一个进程跑多局游戏需要严格串行（之前闭包模式下两闭包可以"假装"独立）
- **state 不可变约定消失**：之前 immutable 强制每个更新都有原子性，编辑器可以追踪变化；现在 state 字段直接改，新人 onboarding 容易改错字段。**缓解**：atom 仍是唯一写入入口（lint 规则 / code review 抓）；`state` 文档标注 "do not mutate outside atom apply"
- **dispatch 不阻塞 executeP 是隐式契约**：caller 必须知道 `dispatch` 返回时 execute 可能还在挂。**缓解**：`TestEngine.dispatchAndWait` / `engine-helpers` 集中暴露 await executeP 的语义
- **EngineContext 仍模块级**（`fireDispatchReady`, `activeExecuteP`）：这些本就是 dispatch 函数内的闭包状态，提到顶层后逻辑分散了 2 个文件

### 不改的部分

- `Atom.apply` void 返回 + in-place mutation（ADR 0012 + 0026 已定）
- `ClientMessage` 协议层 type 保持英文（wire 协议不属于业务概念，CLAUDE.md §5）
- `SkillModule.createSkill` 仍要求每个 skill 模块导出
- `createGameState({ players, cardMap })` 工厂保留 —— 测试构造 state 用，引擎入口用 `create(config)`
- Hook 注册表（`beforeHooks` / `afterHooks`）走模块级 Map，不跟 state 走

## 迁移路径

### Phase 1：基础设施（已完成）

1. `create-engine.ts` 重写为顶层函数（Task 5）
2. `engine-api.ts` 改 state mutation（Task 3）
3. 42 个 atom apply 改 in-place（Task 1-2）
4. `_runtimeApi` / `setRuntimeApi` 删（Task 4）

### Phase 2：开局解耦（已完成）

5. `开局.ts` 改 `onInit(skill, state: GameState)` + 直接 import `registerActionEntry`
6. `create` 改同步、`bootstrap` 异步独立导出
7. `session.ts` 改用 `create + await bootstrap` 模式

### Phase 3：dispatch 改非阻塞（已完成）

8. dispatch 主动路径只 await 到 `fireDispatchReady`，不 await `executeP`
9. `engine-helpers.ts` 加 `dispatchAndWait` 给测试用

### Phase 4：restore 路径（已完成）

10. `persistence.ts::restoreFromLog` 返回 JSON 快照 state（可序列化数据：rngSeed/players/actionLog）
11. `session.restoreState` 编排 create + bootstrap + restore 三段式重建（含内存注册）
12. `tests/integration/restore-from-log.test.ts` 验证往返

### Phase 5：测试 harness 适配（已完成）

13. `engine-harness.ts` / `engine-helpers.ts` 用 `TestEngine` 包装 state
14. `tests/integration/new-engine-*.test.ts` 4 个文件用新 API
15. `tests/integration/engine-isolation.test.ts` 删除（过时）
16. `tests/integration/create-game.test.ts` 用 `create + await bootstrap` 模式

## 与现有 ADR 的关系

- **取代**：旧的 `createEngine(): EngineInstance` 闭包工厂模式
- **依赖**：ADR 0012（atom apply void / 原地变更）、ADR 0030（skill/character 解耦，模块注册机制）
- **配合**：ADR 0026（统一引擎架构）规划中 —— 0026 提到 `GameAction` 简化和 handler 层消失，0027 提前把 engine 入口的闭包依赖拆掉为 0026 铺路
- **影响**：`src/server/session.ts`（game lifecycle 改为 state 持有而非 engine 持有）；`tests/engine-harness.ts`（改用 state 直接持有）

## 代码示例

### server session 启动一局

```ts
// src/server/session.ts
async startGame(config: GameConfig): Promise<void> {
  resetForTest();
  this.state = create(config);
  await bootstrap(this.state, config);
  this.broadcastView();
}

async dispatchMessage(message: ClientMessage): Promise<DispatchResult> {
  if (!this.state) return { error: 'no game' };
  return dispatch(this.state, message);
}
```

### 测试构造一个集成场景

```ts
// tests/integration/new-engine-kill.test.ts
beforeEach(() => {
  resetForTest();
  state = buildInitialState();
  rebootstrap(state);
});

it('出杀:无回应 → 目标扣 1 血', async () => {
  await dispatch(state, { skillId: '杀', actionType: 'use', ownerId: 'P1', params: {...} });
  await dispatch(state, { skillId: '闪', actionType: 'respond', ownerId: 'P2', params: {} });
  expect(state.players.find(p => p.name === 'P2')!.health).toBe(3);
});
```

### restore-from-log（重建内存状态 + 重放）

```ts
// src/server/session.ts
async restoreState(state: GameState, actionLog: ActionLogEntry[]): Promise<void> {
  const config: GameConfig = { seed: state.rngSeed, playerCount: state.players.length, ... };
  const fresh = create(config);
  await bootstrap(fresh, config);          // 重建全部运行时内存注册(开局 dispatch + skill 实例 + 全局 hooks + respond actions)
  await restore(fresh, config, actionLog); // 重放 actionLog 推进到正确状态(settle 同步)
  this.state = fresh;
  this.broadcastView();
}
```

### 系统技能（开局）注册

```ts
// src/engine/create-engine.ts
export async function bootstrap(state: GameState, gameConfig: GameConfig): Promise<void> {
  const 开局 = await import('./skills/开局');
  const syntheticSkill = 开局.createSkill('开局', '主公');
  开局.onInit(syntheticSkill, state);  // ← state,不是 BackendAPI

  const result = await dispatch(state, {
    skillId: '开局', actionType: 'start', ownerId: '主公',
    params: { ...gameConfig } as Record<string, Json>,
    baseSeq: 0,
  });
  if (result.error) throw new Error(`开局失败: ${result.error}`);

  skillRebootstrap(state);
}
```
