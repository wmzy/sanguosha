# ADR 0027 — create-engine 重构：顶层函数 + state 原地变更

**状态**: 已采纳

**前置依赖**: ADR 0012、ADR 0013、ADR 0026

## 背景

旧 `createEngine()` 是闭包工厂 —— 调用一次返回一个新 `EngineInstance`，所有引擎状态（activeExecuteP、action 注册表、hook 注册表、skill 实例表）藏在闭包里。`dispatch` / `buildView` / `rebootstrap` / `getState` 都是 `EngineInstance` 上的方法。这种模式积累出几个问题：

### 1. 多实例隔离成本高

测试同时跑两个独立游戏（replay + 实际执行对比）很常见，但旧 API 强制两个闭包各自维护一份全局表（actions / hooks / instances），谁也碰不到谁；只要 reset 一份，另一份就废。`engine-isolation.test.ts` 就是这个痛点的活化石 —— 最后被删掉了。

### 2. 开局 skill 跟 BackendAPI 强耦合

旧 `开局.onInit(skill, api: BackendAPI)` 走 `api.registerAction(entry)` 把开局流程挂进 action 表。但开局的"玩家"是"主公"这个虚拟身份，跟 BackendAPI 提供的"当前 self"语义对不上；`BackendAPI` 又携带 `_runtimeApi` 之类的 engine-私有字段，开局不得不学着普通技能的样子去申请一个 `api.runtimeApi`，把"系统一次性 bootstrap"硬塞进了"玩家技能实例"模型。

### 3. restore 路径被迫重跑开局

旧 `restoreFromLog` 反序列化得到 state 后，还得 `createEngine()` 起一个闭包、调一次 `bootstrap`，dispatch 一条 `start` 让 `开局` 跑过完整的 抽身份/选将/洗牌/发牌/启动第一回合。但日志里这些动作都已经记录了 —— 重新跑一遍既慢又可能因为 `seed` 不一致产生不同结果。

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

**为什么这样拆**：restore-from-log 路径不需要 bootstrap —— replay 出来的 state 已经完成开局，直接用即可。同步 create + 异步 bootstrap 让 server `startGame` 和 `restoreFromLog` 用同一种 `create` 出 state，但只有前者 `await bootstrap` 跑开局，后者直接走 session 启动。

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

### 决策 7：restoreFromLog 不调 bootstrap

`src/server/persistence.ts::restoreFromLog(persisted)` 直接返回 `persisted.state`，不调 `create` / `bootstrap`。`session.startGame` 检测到是 restore 路径时只把 state 挂到 session，不重复开局。

## 后果

### 正面

- **EngineInstance 类型消失**：所有 API 签名显式带 state，调用方无法误用（"用错 engine" 类 bug 静态可查）
- **开局解耦 BackendAPI**：开局面板只读 state、注册 action entry、返回 unregister 函数；不申请任何 engine 私有 API
- **restore 路径快**：replay 出来的 state 直接用，省一次 dispatch 开局的全流程（~30 个 atom apply 加上 4 个 player 的 skillRebootstrap）
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

10. `persistence.ts::restoreFromLog` 直接返回 persisted.state，不调 bootstrap
11. `app.ts` 调 `restoreFromLog` 拿到 state 后挂到 session
12. `tests/integration/restore-from-log.test.ts` 验证往返

### Phase 5：测试 harness 适配（已完成）

13. `engine-harness.ts` / `engine-helpers.ts` 用 `TestEngine` 包装 state
14. `tests/integration/new-engine-*.test.ts` 4 个文件用新 API
15. `tests/integration/engine-isolation.test.ts` 删除（过时）
16. `tests/integration/create-game.test.ts` 用 `create + await bootstrap` 模式

## 与现有 ADR 的关系

- **取代**：旧的 `createEngine(): EngineInstance` 闭包工厂模式
- **依赖**：ADR 0012（atom apply void / 原地变更）、ADR 0013（skill/character 解耦，模块注册机制）
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

### restore-from-log

```ts
// src/server/session.ts
async restoreFromLog(persisted: PersistedState): Promise<void> {
  resetForTest();
  this.state = restoreFromLog(persisted);  // 直接返回 persisted.state,不调 bootstrap
  rebootstrap(this.state);                  // 重新挂 skill 实例(因为模块级表被 reset 清空)
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
