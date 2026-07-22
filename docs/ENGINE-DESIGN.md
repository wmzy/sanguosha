# 三国杀引擎设计文档

> 最终设计，不含历史变更。

## 1. 架构总览

```
客户端 ──action──→ 技能(SkillDef) ──await apply(atom)──→ GameState
                                                   │
                                                   └──awaits──→ 结算区栈 ──事件流──→ 前端UI
```

两层职责：

| 层 | 概念 | 职责 | 例子 |
|---|---|---|---|
| **Action** | 外部输入 | 表达玩家意图，技能通过 `registerAction` 声明入口 | 出杀、出闪、发动八卦阵 |
| **Atom** | 状态变更 + 等待 | 最小状态变换单元；带 `awaits` 的 atom 同时管理等待回应 | 造成伤害、询问闪、请求回应 |

核心不变量：
+ **所有状态变更必经 atom**。技能通过 `await apply(atom)` 产生状态变更
+ **所有外部输入必经 action**。客户端只能触发已注册的 action
+ **所有等待回应由 atom 的 `awaits` 声明**。不再有独立的 request 概念，等待是 atom 的属性

## 2. 客户端协议

客户端发送 `ClientMessage`，只有一种——触发 action：

```ts
interface ClientMessage {
  /** 目标技能 */
  skillId: string;
  /** 技能内定义的 action 类型 */
  actionType: string;
  /** action 参数，由技能定义和校验 */
  params: Record<string, Json>;
  /** CAS 序列号，用于乐观并发控制 */
  baseSeq: number;
}
```

服务端收到后：
1. CAS 校验：`baseSeq !== state.seq` → 静默丢弃
2. 路由到 `skillId` 对应技能的 `actionType` 处理函数
3. 技能的 `validate` 校验参数合法性
4. 执行技能的 `execute`

`params` 由各技能自行定义和消费，引擎不解释其内容：
+ 杀：`{ cardId: 'c42', targets: ['P2'] }`
+ 八卦阵回应：`{ choice: true }`
+ 遗计分配：`{分配: [{ target: 'P3', count: 2 }, { target: 'P1', count: 1 }] }`
+ 装备：`{ cardId: 'c33' }`

不存在 `GameAction` 类型。"使用杀"、"出闪响应"、"发动八卦阵"都统一为 `ClientMessage`，区别是 `skillId` + `actionType`。

## 3. 牌

牌是**令牌**（token），只有属性：

```ts
interface Card {
  id: string;
  name: string;         // '杀' | '闪' | '桃' | '无中生有' | ...
  suit: '♠' | '♥' | '♣' | '♦';
  rank: number;
  type: '基本牌' | '锦囊牌' | '装备牌';
  subtype?: string;     // 装备: '武器' | '防具' | '进攻马' | '防御马'; 基本: '火杀' | '雷杀'
}
```

牌不携带行为。"使用杀的效果是什么"属于技能定义，不属于牌。

### 3.1 技能转化（影子卡牌 + 组合 action）

某些技能可以把一张牌当另一种牌使用（武圣：红牌当杀，倾国：黑牌当闪，龙胆：杀当闪/闪当杀）。

#### 影子卡牌

转化时**不 mutate 原卡**，而是新建一个 **影子 Card 实体**，name/suit/rank 是转化后的视图，`shadowOf` 指向原卡：

```ts
type Card = {
  id: string;
  name: string;
  suit: ...; rank: string; type: ...; subtype?: string;
  /** 影子卡:若设置,本卡是由 shadowOf 指向的原卡转化而来。原卡仍在 cardMap。 */
  shadowOf?: string;
};
```

影子卡 id 形如 `${原id}#${skillId}`(如 `c1#武圣`)。玩家手牌引用影子 id(原卡被替换出 hand)。
影子离开结算(入弃牌堆)时，`移动牌` atom 用 `shadowOf` 还原——弃牌堆收原卡 id，删除影子 cardMap 条目。原卡属性全程不变。

#### 组合 action(转化 + 使用)

转化是**前置 action**(`preceding`)，与主 action(杀.use)在**一个 ClientMessage** 中提交：

```ts
interface ClientMessage {
  skillId: string; actionType: string; ownerId: number; params; baseSeq;
  /** 在主 action 前顺序执行的前置 action(转化类)。dispatch 逐个 validate+execute。 */
  preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>;
}
```

**前端流程**(两步 UI、一次提交)：
1. 玩家点击武圣 → 前端给手牌中的红牌加"杀"显示(纯前端,不提交)
2. 玩家按杀的方式选目标、点出牌
3. 提交:一个 ClientMessage,`preceding=[武圣.transform]` + 主 action `杀.use`

**后端执行**(dispatch)：
1. 先执行 preceding:武圣.transform validate(红牌校验) + execute(创建影子卡 c1#武圣,手牌引用替换)
2. 主 action 杀.use validate → 读 `cardMap[c1#武圣]` 看到"杀" → 通过(**杀零感知武圣**)
3. 杀.use execute → 正常出杀流程(移动牌/询问闪/造成伤害/入弃牌堆)

**回滚**：preceding 的 action 可选实现 `rollback`。主 action validate 失败时，dispatch 对已执行的 preceding 按逆序调用 rollback，恢复 state。武圣.transform 的 rollback：删除影子卡、手牌还原为原卡 id。

```ts
interface ActionEntry {
  validate; execute;
  /** 可选:回滚 execute 的副作用。仅"可组合 action"(用于 preceding)需要实现。 */
  rollback?: (state, params) => void;
}
```

杀的 filter/validate/execute 完全不用改——它看到的就是一张"杀"。转化(影子创建)、回滚、还原都是武圣自己的事。

## 4. 技能

技能是**async 函数**。技能通过 `onInit` 注册后端逻辑（action + 钩子），通过 `onMount` 注册前端 UI。

### 4.1 API 概览

```ts
// 技能模块,一个技能一个模块文件,通过 skills/index.ts 的 skillLoaders map 懒加载
// 导出 SkillModule 对象(default export)
import type { SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill;

export function onInit(
  skill: Skill,
  ownerId: number,
): (() => void) | void;

// 可选:前端挂载
export function onMount(
  skill: Skill,
  api: FrontendAPI,
): (() => void) | void;

export default { createSkill, onInit, onMount } satisfies SkillModule;
```

```ts
interface Skill {
  id: string;
  ownerId: number;  // 座次下标
  name: string;
  description: string;
}
```

技能不通过闭包对象(BackendAPI/EngineApi)操作状态,而是直接 import 顶层函数:
+ `registerAction`、`registerBeforeHook`、`registerAfterHook` ← `'../skill'`
+ `applyAtom`、`pushFrame`、`popFrame`、`topFrame`、`pushNotify` ← `'../create-engine'`
+ `state` 和 `ownerId` 通过 validate/execute 参数或 onInit 闭包传入,不需要全局单例

**tree-shaking**：
+ 前端构建：不引用 `onInit` / `registerAction` / `applyAtom` 等，后端逻辑被 tree-shake
+ 后端构建：不引用 `onMount` / `FrontendAPI`，前端逻辑被 tree-shake
+ `createSkill` 前后端都保留

### 4.2 顶层函数式 API（无闭包对象）

技能 `onInit(skill, ownerId)` 中直接 import 并调用顶层函数注册 action 和钩子。没有 `BackendAPI` / `EngineApi` 闭包对象——`state` 和 `ownerId` 通过参数和闭包传递：


```ts
// 从 skill.ts import
import { registerAction, registerBeforeHook, registerAfterHook } from '../skill';
// 从 create-engine.ts import
import { applyAtom, pushFrame, popFrame, topFrame, pushNotify } from '../create-engine';

// 注册 action。当客户端触发匹配 skillId 和 actionType 时,execute 被调用。
// validate 不通过 → 静默丢弃,不记入 action 日志。返回卸载函数。
registerAction(
  skillId: string,
  ownerId: number,   // 座次下标
  actionType: string,
  validate: (state: GameState, params: Record<string, Json>) => string | null,
  execute: (state: GameState, params: Record<string, Json>) => Promise<void>,
): () => void;

// 注册 atom apply 前钩子。在 atom 压栈后、validate 前调用。
// 可以 await applyAtom(state, 其他 atom) 嵌套副作用。
// before 钩子返回 HookResult 干预当前 atom(pass/modify/cancel),见 §4.5。
registerBeforeHook(
  skillId: string,
  ownerId: number,
  atomType: string,
  handler: (ctx: AtomBeforeContext) => Promise<HookResult | void>,  // void = pass
): () => void;

// 注册 atom apply 后钩子。可以 await applyAtom(state, 其他 atom) 嵌套副作用。
// after 钩子是纯副作用,不能 modify/cancel(事件已发生)。
registerAfterHook(
  skillId: string,
  ownerId: number,
  atomType: string,
  handler: (ctx: AtomAfterContext) => Promise<void>,
): () => void;

// 应用一个 atom,走完整 pipeline(before hooks 折叠 → validate → apply → after hooks → pending)
applyAtom(state: GameState, atom: Atom): Promise<void>;

// 帧管理
pushFrame(state: GameState, skillId: string, from: number, params?: Record<string, Json>): SettlementFrame;
popFrame(state: GameState): void;
topFrame(state: GameState): SettlementFrame | undefined;

// 往前端事件流插入通知事件(不改变状态)
pushNotify(state: GameState, event: NotifyEvent): void;
```

**HookResult**(before 钩子返回值,干预当前 atom):
```ts
type HookResult =
  | { kind: 'pass' }                              // 不干预(默认;返回 void 也视为 pass)
  | { kind: 'modify'; atom: Atom }                // 修改参数,管线用新 atom 继续(叠加生效,座次序)
  | { kind: 'cancel' };                           // 取消当前 atom(不进入 validate/apply/after;推 notify 事件)
```

### 4.3 结算帧与结算区栈

引擎维护一个**结算区栈**（settlement stack）。**帧由技能在 execute 中显式创建**，引擎不自动创建或管理帧的生命周期——技能决定何时创建、何时销毁。

```ts
interface SettlementFrame {
  /** 触发此结算的技能 */
  skillId: string;
  /** 触发来源(座次下标) */
  from: number;
  /**
   * 结算参数。execute 创建帧时初始化一次。
   *
   * 两层语义:
   *  - 配置数据(cardId/targets 等):后续只读。
   *  - 可变结算状态(如 resolvedTargets):允许 mutate 数组元素(引用语义),
   *    用于被动技能在 hook 中改写结算目标。典型:流离在 `成为目标` after hook 中
   *    改写 `frame.params.resolvedTargets[i]`,杀在后续结算循环读到新目标。
   *    这种 mutate 绑定在特定帧上,天然支持嵌套(南蛮→杀→流离 各有独立帧),
   *    优于迁到全局 localVars(会被嵌套同名帧覆盖)。
   *
   * 不要替换 params 对象本身,只改内部字段。
   *
   * 跨 atom 通信的一般途径是 state 观察(zones/tags/marks/localVars);
   * params 的可变字段是针对"结算目标在 hook 中被改写"这一场景的特设机制。
   */
  params: Record<string, Json>;
}
```

帧是纯数据——**没有 `apply`/`notify` 方法**。所有操作通过顶层函数 `applyAtom`/`pushNotify` 等。

> **处理区牌**:结算中的牌存在 `state.zones.processing`(全局共享),不挂在帧上。
> 帧只管自己的结算参数,引擎集中管理处理区便于多个帧/atom 互查。

**技能显式管理帧**：

```ts
// 杀技能的 execute——技能自己创建帧、结算、销毁
async (state: GameState, params: Record<string, Json>) => {
  const from = ownerId;  // onInit 闭包(ownerId: number,座次下标)
  const cardId = params.cardId as string;
  const targets = params.targets as number[];
  // 帧在创建时初始化结算数据。配置字段(cardId/targets)后续只读;
  // 可变字段(如 resolvedTargets)允许被动技能在 hook 中 mutate 元素改写结算目标(见 §4.3 params 两层语义)。
  const frame = pushFrame(state, '杀', from, { cardId, targets, resolvedTargets: [...targets] });

  await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
  await applyAtom(state, { type: '指定目标', source: from, target: 1 });  // target = 座次下标

  // 等待型 atom:进入 pending,Promise 挂起
  await applyAtom(state, { type: '询问闪', target: 1, source: from });
  // ↑ 闪 respond 后(或超时 onTimeout 为空函数)Promise resolve
  // 父 action 通过观察 state.zones.processing 判断是否闪避(见 §4.10)

  // 结算后:清理 + 牌入弃牌堆
  popFrame(state);
}
```

帧的创建和销毁是 action 的责任,不是引擎的。action execute 的 validate/execute 签名接收 state 和 params 参数。

**嵌套自然隔离**——南蛮入侵 execute 中触发杀，杀创建自己的帧：

```
结算区栈:
  [南蛮入侵(P1)]              ← 栈底(南蛮入侵创建)
    [杀(P1→P2)]               ← 杀在 execute 中创建
      询问闪 → 进入 pending 区(见 §4.4)
```

**action 不支持钩子**。它只是技能的入口路由，`skillId + actionType` 唯一确定一个回调。
+ validate 不通过 → 静默丢弃，不记入 action 日志
+ 技能间协作通过 atom 钩子和 **state 观察**(zones/tags/marks/localVars),不通过 frame.params 突变

**action 调用路径**(统一,不区分主动/回应)：

客户端发 `ClientMessage` → CAS 校验 → 路由到 action → validate → execute(api)。execute 内部通过 `applyAtom` 驱动所有状态变更和等待——包括嵌套等待(询问闪、请求回应)和嵌套帧创建(杀、南蛮入侵)。

### 4.4 等待型 Atom 与 Pending 区

游戏等待玩家输入是一个**原子操作**——游戏同时只有一个等待。等待型 atom 和普通 atom 走**同一条 `applyAtom` 路径**（§6.1），唯一区别是 apply 流程结束后进入 pending 区而非立即 resolve Promise。

**核心机制**：

+ 等待型 atom 的 `AtomDefinition` 声明 `pending` 字段（§5）
+ `applyAtom(state, 等待型atom)` 执行完 before hooks → validate → apply → after hooks → 弹栈后，进入 **pending 区**，`applyAtom` 返回的 Promise 挂起
+ pending 区只有一个位置——**同时只有一个等待**
+ 等待结束方式: **响应到达**(target 的 respond action execute 完,slot 被消费) 或 **超时**(`pending.onTimeout` 声明的 async 函数被调用,内部可自由编排 applyAtom)
+ **等待型 atom 不可被丢弃/取消**——必走完上述两条路径之一(没有 `drop()` 机制)
+ `pending.timeout` 与 `pending.onTimeout` **都是必填**——没有合理默认值

**before hooks 可以插入等待**：当前 atom 还在 apply 栈上没弹出时，钩子可以 `await applyAtom(ctx.state, 另一个等待型atom)` 嵌套执行。比如八卦阵在 `询问闪` 的 before hook 中**直接调用 `判定` atom**（三国杀标准规则：八卦阵判定自动触发，无确认步骤）：

```
applyAtom(state, 询问闪):
  压栈：[询问闪]
  before hooks:
    八卦阵-P2:
      applyAtom(ctx.state, 判定, { player: P2, judgeType: '八卦阵' })
        压栈：[询问闪, 判定]
        before → validate → apply → after → 弹栈
        判定牌进弃牌堆（引擎清理）
        apply 栈：[询问闪]
      // 钩子读弃牌堆顶 → 红色 → 往处理区放一张虚拟闪牌(cardMap + zones.processing)
      //          ← 杀.execute 后续检查处理区发现闪，视为闪避
      // 判定失败 → 不放虚拟闪 → 杀.execute 检查处理区无闪，造成伤害
    闪-P2: 无事发生
  // 所有 before hooks 结束
  validate → apply → after → 弹栈
  检测到 pending → 进入 pending 区 → Promise 挂起
  // 等用户出闪或超时(onTimeout 为空函数)
```

> **实现注**：实际八卦阵实现不走「请求回应（是否发动八卦阵）」的确认步骤——三国杀标准规则下判定自动触发。上面流程图只展示 hook 嵌套调用的一般能力（hook 中可以 `await applyAtom` 任何 atom，包括等待型），实际八卦阵的简洁实现见 §4.10 八卦阵示例。
+ 旧 slot 的 Promise **直接 resolve**(不 fire onTimeout,因为旧 atom 已被新 wait 取代)
+ 旧 atom 已应用的 state 变更**保留**,不回滚
+ 新 atom 走完整 apply 流程后入 slot
+ 典型场景: 闪响应后用户在 5s 内又发动某技能,新生成的等待顶替

**超时行为**：`pending.onTimeout` 是一个 async 函数 `(state, atom) => Promise<void>`,引擎在 slot 超时时调用。函数内部可自由编排 `applyAtom`(支持多步操作),每个 applyAtom 照常走完整 pipeline(before/after hooks 正常触发)。**onTimeout 必填**——典型场景是 `async () => {}`(超时不做事,继续结算);需要做事的如弃牌超时 `async (s, a) => { await applyAtom(s, 弃牌atom) }`。

**前端感知**：等待型 atom 进入 pending 区时下发 atom 事件,事件带时间戳：

```ts
{ kind: 'atom', atom: { type: '询问闪', target: 'P2' },
  pending: { startTime: 4500, deadline: 34500 } }
```

前端根据 `pending` 字段显示倒计时/进度条,根据 `prompt` 渲染回应 UI,根据等待型 atom 的 `AtomDefinition.pending.prompt` 启用对应的 action 按钮。

**`applyAtom(state, atom)` 返回 `Promise<void>`**。等待型 atom 的 Promise 在被消费(用户回应 / 超时)时 resolve。技能代码用 `await applyAtom(state, ...)` 自然暂停/恢复,不需要回调或续跑机制。

**多询问合并(同时机多询问)**：当多个 hook 在同一时机各自 `applyAtom(请求回应)` 时，引擎的"同时只一个 pending"不变量通过 **choiceQueue** 保持——对用户永远只看到一个等待。

机制：
- `state.pendingSlot` = 当前正在处理的单一询问(用户看到的)。不变。
- `state.choiceQueue` = 等待队列(通常空)。当新询问发现 pendingSlot 已被占时,两个询问都入队,pendingSlot 替换为一个"选择"询问。

```
hook A:applyAtom(请求回应-A) → pendingSlot = A
hook B:applyAtom(请求回应-B) → 发现 pendingSlot 已占
  → choiceQueue = [A, B],pendingSlot = "选择先响应哪个"
  → 用户选 A → pendingSlot = A,choiceQueue = [B]
  → A resolve → promoteChoiceQueue → pendingSlot = B,choiceQueue = []
  → B resolve → promoteChoiceQueue → pendingSlot = undefined
```

对用户始终只看到一个 pending(要么是原始询问,要么是"先选哪个")。choiceQueue 是引擎内部的冲突解决缓冲,不是并行询问。

**多人响应(无懈可击/濒死求桃/于吉蛊惑)**：三国杀里所有"多人交互"都是**依次串行**的,不是并发——求桃是从当前玩家开始轮询、无懈是抢占式(一轮收一个)、质疑是依次问每个玩家。因此**同时只一个 pending 的不变量足够表达全部**,无需并发等待。

- **逐个询问(濒死/决斗/蛊惑)**:`for (player of 轮转序列) { await applyAtom(请求回应, { target: player }) }`——每人一个 pending,串行。回应结果通过 `state.localVars` 观察。
- **抢占式(无懈可击)**:每轮一个 pending,允许**任一活着的玩家**回应(非单 target);第一个有效 respond 占用并 resolve,下一轮无懈是新的 pending。父 execute 用循环收集无懈数量,奇偶决定原锦囊是否生效:
```ts
// 锦囊 execute 内
let cancelCount = 0;
while (true) {
  await applyAtom(state, { type: '请求回应', requestType: '无懈', target: 广播 });
  // 注:请求回应 的 onTimeout 默认为空函数(超时=本轮无人打无懈)
  if (!state.localVars['无懈/本轮已打']) break;  // 超时=本轮无人打无懈
  cancelCount++;
}
const 生效 = cancelCount % 2 === 0;  // 偶数=原锦囊生效,奇数=被抵消
```
抢占式 pending 的"任一玩家可回应"是数据层约定(`请求回应` 声明合法回应者集合),不打破单槽不变量——仍是同时只一个 pending,只是回应者不限于单一 target。

### 4.5 Atom 钩子

Atom 钩子挂载在 atom 类型上,在 `applyAtom(state, atom)` 流程中触发(§6.1)。before 钩子按注册顺序(座次序)依次跑,可叠加 modify。

**before 钩子**——在 atom 压栈后、真正应用前执行。可以:
- **应用新 atom**: 通过 `await applyAtom(ctx.state, ...)` 插入新的状态变更(等待型也行,见 §4.4 嵌套例)
- **修改当前 atom**: 返回 `{ kind: 'modify', atom: 修改后的atom }`,管线用新 atom 继续;后续 before 钩子收到修改后的值(藤甲 -1 后白银狮子看到减过的伤害,叠加生效)
- **取消当前 atom**: 返回 `{ kind: 'cancel' }`,atom 不进入 validate/apply/after;管线推一个 notify 事件让前端感知(仁王盾黑杀无效、寒冰剑改为弃牌)。cancel 后后续 before 钩子不再跑
- **不干预**: 返回 `{ kind: 'pass' }` 或 `void`(默认)

```ts
interface AtomBeforeContext {
  state: GameState;
  atom: Atom;
  /** 钩子注册时绑定的 ownerId(skill 实例的所属玩家,座次下标) */
  ownerId: number;
  /** 当前结算帧(params 可变字段允许 mutate 元素,见 §4.3) */
  readonly frame: SettlementFrame;
  /** frame.params 的只读快照 */
  readonly params: Record<string, Json>;
}
```

**after 钩子**——在 atom 真正应用后执行。可以:
- **应用新 atom**: 如遗计在"受到伤害"后摸牌、分牌,通过 `await applyAtom(ctx.state, ...)`
- **读取 state** 决定副作用(通过 `ctx.state`)

```ts
interface AtomAfterContext {
  state: GameState;
  atom: Atom;
  /** 钩子注册时绑定的 ownerId(skill 实例的所属玩家,座次下标) */
  ownerId: number;
  /** 当前结算帧 */
  readonly frame: SettlementFrame;
  /** frame.params 的只读快照 */
  readonly params: Record<string, Json>;
}
```

钩子通过 `await applyAtom(ctx.state, ...)` 操作状态(见 §4.2)。跨 atom 通信通过三种方式:
1. **处理区(牌列表)**:响应技能(闪/杀 respond)把牌移入处理区,父 action(杀/决斗)结算时检查处理区有没有对应牌——这是响应类结算的核心模式。
2. **state.localVars**:被动 hook 用 localVars 与 respond action 通信(hook 设 localVars 后 await 请求回应,respond action 写入 localVars,hook 恢复后读取)。before 钩子可返回 `HookResult`(pass/modify/cancel)。
3. **frame.params 的可变字段**:被动 hook(如流离)在 `成为目标` after hook 中改写杀帧的 `resolvedTargets` 数组元素,杀的结算循环从帧上读到新目标(见 §4.3 params 两层语义)。适用于"结算目标在 hook 中被改写"这一场景。

**`询问闪` 的 before 钩子示例**:
- 八卦阵: 判定 → 红色 → 往处理区插入一张虚拟的闪牌。杀不需要知道八卦阵——只检查处理区有没有闪牌。
- 询问闪继续走完 validate/apply 并进入 pending(等用户出闪);若用户最终未出闪,onTimeout 为空函数触发,杀.execute 检查处理区无闪牌则造成伤害

**闪的回应 action execute**: 移牌从手牌→**处理区**(不是直接进弃牌堆)。父 action(杀/万箭齐发)结算时检查处理区有没有闪牌,有则移入弃牌堆(闪避成功),没有则造成伤害。

**`成为目标` 的 after 钩子示例**:
- 流离(大乔): `atom.target === ctx.ownerId` → 通过 `await applyAtom(ctx.state, 请求回应)` 让用户选新目标,respond action 设 `state.localVars['流离/target']`,hook 恢复后读取并 **mutate 杀帧的 `frame.params.resolvedTargets`** 改写当前结算目标

**`造成伤害` 的 after 钩子示例**:
- 遗计(郭嘉): `target === ctx.ownerId` → `await applyAtom(ctx.state, 摸牌)` + `await applyAtom(ctx.state, 请求回应)` 分配牌
- 反馈(司马懿): `target === ctx.ownerId` → `await applyAtom(ctx.state, 获得牌)` 从伤害来源获得一张牌
- 两个钩子都执行(副作用语义),遗计先执行完,反馈再执行

### 4.6 通知事件

技能可以往前端事件流插入通知事件，不改变状态。和 atom 事件在同一个流中按序到达前端。

```ts
type GameEvent =
  | { kind: 'atom'; atom: Atom; viewEvents?: ViewEventSplit }
  | { kind: 'notify'; skillId: string; eventType: string; data: Json; views?: NotifyPlayerViews }

/** 通知事件的 per-player 视图分叉 */
type NotifyPlayerViews = ReadonlyMap<string, Json>;  // key = 玩家ID, value = 该玩家看到的 data
```

通知事件的用途：
+ 技能前端 UI 订阅特定 `skillId + eventType`，据此显示/隐藏 action 按钮、播放动画
+ 前端玩家点击按钮 → 发送 `ClientMessage` 回应

### 4.7 前端 API

```ts
interface FrontendAPI {
  viewer: string;

  /** 订阅事件流中的事件。atom 事件和通知事件都会触发 */
  onEvent(handler: (event: GameEvent, view: GameView) => void): () => void;

  /**
   * 声明式定义 action UI。前端引擎根据 atom 事件流自动管理按钮的显示/隐藏。
   */
  defineAction(actionType: string, opts: {
    label: string;
    style?: 'primary' | 'danger' | 'default' | 'passive';
    prompt: ActionPrompt;
    /** 可选：牌转化函数（武圣：红牌当杀） */
    transform?: (card: Card) => CardWrapper;
  }): void;

  /** 播放动画/音效 */
  playEffect(effect: AtomEffect): void;
}
```

技能前端代码调用 `defineAction` 声明每个 action 的 UI 配置。前端引擎监听 atom 事件流，根据事件自动管理按钮的显示/隐藏时机（如收到 `阶段开始` atom 且 phase=出牌阶段 → 显示可用按钮）。

`ActionPrompt` 中的 `filter` 函数（`CardFilter.filter`、`TargetFilter.filter`）纯前端运行，用于限制可选范围，不走后端 `validate`。后端 `validate` 只校验最终提交的 params。

### 4.8 GameView——前后端共用的游戏视图

```ts
interface GameView {
  viewer: number;
  currentPlayerIndex: number;
  phase: TurnPhase;
  turn: { round: number; phase: TurnPhase; vars: Record<string, Json> };
  players: {
    health: number;
    maxHealth: number;
    alive: boolean;
    equipment: Partial<Record<EquipSlot, string>>;
    skills: string[];
    handCount: number;
    hand?: Card[];
  }[];
  cardMap: Record<string, Card>;
  pending: PendingView | null;
}
```

后端从 `GameState` 派生 `GameView`：公开信息直接映射；`viewer` 的手牌完整暴露，其他玩家只给 `handCount`。

前后端共用 `validate` 的前提：技能发动条件只依赖公开信息 + 自身手牌，不依赖其他玩家的私有信息。三国杀满足此条件。

### 4.9 ActionPrompt——前端交互声明

`ActionPrompt` 定义前端如何渲染操作 UI。三国杀中交互形式可枚举：

```ts
type ActionPrompt =
  | UseCardPrompt           // 选牌（杀、闪、桃、锦囊）
  | SelectTargetPrompt      // 选目标（顺手牵羊、过河拆桥）
  | UseCardAndTargetPrompt  // 选牌 + 选目标（杀、南蛮入侵响应）
  | ConfirmPrompt           // 确认/取消（是否发动八卦阵）
  | DistributePrompt        // 分配（遗计分配牌）
  | ChoosePlayerPrompt      // 选玩家（反馈、结姻）

/** 选牌 */
interface UseCardPrompt {
  type: 'useCard';
  title: string;
  description?: string;
  cardFilter: CardFilter;
}

/** 选目标 */
interface SelectTargetPrompt {
  type: 'selectTarget';
  title: string;
  description?: string;
  targetFilter: TargetFilter;
}

/** 选牌 + 选目标 */
interface UseCardAndTargetPrompt {
  type: 'useCardAndTarget';
  title: string;
  description?: string;
  cardFilter: CardFilter;
  targetFilter: TargetFilter;
}

/** 确认/取消 */
interface ConfirmPrompt {
  type: 'confirm';
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/** 分配（将牌分给多个玩家） */
interface DistributePrompt {
  type: 'distribute';
  title: string;
  description?: string;
  /** 每张分配的牌的来源（如刚摸到的牌） */
  cardIds: string[];
  minPerTarget: number;
  maxPerTarget: number;
}

/** 选玩家 */
interface ChoosePlayerPrompt {
  type: 'choosePlayer';
  title: string;
  description?: string;
  min: number;
  max: number;
  filter?: (view: GameView, target: number) => boolean;
}

interface CardFilter {
  /** 牌筛选条件 */
  filter?: (card: Card) => boolean;
  min: number;
  max: number;
}

interface TargetFilter {
  min: number;
  max: number;
  /** 距离/阵营等筛选,纯前端运行。target = 座次下标 */
  filter?: (view: GameView, target: number) => boolean;
}
```

### 4.10 示例

下面的示例使用顶层函数式 API(无闭包对象)。**结算数据通过 state 观察**(弃牌堆增量、tags、marks、localVars),
但**结算目标可被 hook 改写**——杀在帧上初始化 `resolvedTargets` 数组,流离在 `成为目标` after hook 中
mutate 该数组的元素,杀的结算循环从帧上读当前值(见 §4.3 params 的两层语义)。

```ts
// ── 杀.ts ──
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';
import { inAttackRange } from '../distance';
import { canSlash, incSlashUsed } from '../slash-quota';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '杀', description: '出牌阶段对攻击范围内一名角色使用杀' };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 牌在手 + 牌名=杀 + 目标合法 + 有出杀额度
      const ok = state.currentPlayerIndex === ownerId
        && state.phase === '出牌'
        && state.pendingSlots.size === 0
        && state.players[ownerId]?.alive === true
        && state.players[ownerId]?.hand.includes(params.cardId as string)
        && state.cardMap[params.cardId as string]?.name === '杀'
        && (params.targets as number[] | undefined)?.every(t => state.players[t]?.alive === true)
        && (params.targets as number[] | undefined)?.every(t => inAttackRange(state, ownerId, t))
        && canSlash(state, ownerId);
      return ok ? null : '现在不能出杀';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const targets = params.targets as number[];
      // 帧上 resolvedTargets:初始化为 targets 副本;流离可在 hook 中 mutate 元素改写目标
      const frame = pushFrame(state, '杀', from, { ...params, resolvedTargets: [...targets] });
      try {
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });

        // 第一阶段:逐个指定所有目标(触发"指定目标时"hook)
        for (const target of targets) {
          await applyAtom(state, { type: '指定目标', source: from, target, cardId });
        }

        // 第二阶段:逐个结算。resolvedTargets 从帧上读(可能被流离改写)
        for (let i = 0; i < targets.length; i++) {
          const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
          const target = resolved[i];

          await applyAtom(state, { type: '成为目标', source: from, target, cardId });  // 触发"成为目标后"hook(如流离),可被 cancel
          await applyAtom(state, { type: '询问闪', target, source: from });

          // 检查处理区:有没有闪牌(目标出闪 / 八卦阵放入的虚拟闪)——drain 所有闪
          const dodgeIds = state.zones.processing.filter(id => state.cardMap[id]?.name === '闪');
          if (dodgeIds.length > 0) {
            for (const dodgeCardId of dodgeIds) {
              await applyAtom(state, { type: '移动牌', cardId: dodgeCardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
            }
          } else {
            // 没闪:造成伤害(触发藤甲/白银狮子/遗计/反馈等,濒死由引擎核心处理)
            // 酒增伤由 酒.ts 的 造成伤害 before hook 负责(返回 { kind:'modify', amount+1 })
            await applyAtom(state, { type: '造成伤害', target, amount: 1, source: from, cardId });
          }
        }

        // 第三阶段:收尾——杀牌移出处理区→弃牌堆
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
        // 异常安全:保证帧弹出 + 杀牌不滞留处理区
        if (state.zones.processing.includes(cardId)) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } }).catch(() => {});
        }
        popFrame(state);
        incSlashUsed(state);  // 出杀次数 +1(状态存 turn.vars['杀/usedCount'],回合结束随 turn.vars 清空)
      }
    },
  );
  return () => {};
}

export function onMount(杀: Skill, api: FrontendAPI) {
  api.defineAction('use', {
    label: '杀', style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择杀和目标',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
      targetFilter: { min: 1, max: 3, filter: (v, t) => isInAttackRange(v, api.viewer, t) },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
```

```ts
// ── 闪.ts ──
export function onInit(skill: Skill, ownerId: number): () => void {
  registerAction(skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      // pending 必须是 询问闪 且问的是本玩家
      const slot = state.pendingSlots.get(ownerId);
      if (!slot || slot.atom.type !== '询问闪') return '当前不需要出闪';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      // 闪牌移到处理区(不是直接弃牌堆)——父 action(杀)结算时检查处理区有闪则视为闪避
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: ownerId }, to: { zone: '处理区' } });
    },
  );
  return () => {};
}
```

```ts
// ── 八卦阵.ts（装备·防具） ──
// 八卦阵:判定红色 → 往处理区插入一张虚拟的闪牌。
// 杀不需要知道八卦阵——只检查处理区有没有闪牌。
import { registerBeforeHook } from '../skill';

export function onInit(skill: Skill, ownerId: number): () => void {
  registerBeforeHook(skill.id, ownerId, '询问闪', async (ctx) => {
    if (ctx.atom.target !== ownerId) return;
    if (ctx.state.zones.deck.length === 0) return;

    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '八卦阵' });

    // 判定后,判定牌已入弃牌堆(引擎 cleanupJudgeZone)。读弃牌堆顶花色。
    const discardPile = ctx.state.zones.discardPile;
    const judgeCard = ctx.state.cardMap[discardPile[discardPile.length - 1]];
    if (!judgeCard) return;

    // 红色:往处理区放入一张虚拟的闪牌,杀检查处理区会看到闪
    if (judgeCard.suit === '♥' || judgeCard.suit === '♦') {
      const dodgeId = `八卦阵:${ownerId}:${judgeCard.id}`;
      ctx.state.cardMap[dodgeId] = { id: dodgeId, name: '闪', suit: judgeCard.suit, rank: judgeCard.rank, type: '基本牌' };
      ctx.state.zones.processing.push(dodgeId);
    }
  });
  return () => {};
}
```

```ts
// ── 酒.ts（增伤走 造成伤害 before hook） ──
// use action:为下一张杀加 mark（'酒/nextKillDamageBonus', duration='turn'）。
// 增伤效果通过 造成伤害 before hook 实现——杀不需要知道酒的存在。
import type { HookResult } from '../types';
import { registerBeforeHook } from '../skill';

export function onInit(skill: Skill, ownerId: number): () => void {
  // ... use action 推 '酒/nextKillDamageBonus' mark ...

  // 造成伤害 before hook:自己是伤害来源 且 持有 mark → 消费 mark 并 modify atom.amount += 1
  registerBeforeHook(skill.id, ownerId, '造成伤害', async (ctx): Promise<HookResult | void> => {
    if (ctx.atom.source !== ownerId) return;
    if (ctx.atom.amount <= 0) return;
    const self = ctx.state.players[ownerId];
    const hasMark = self?.marks.some(m => m.id === '酒/nextKillDamageBonus');
    if (!hasMark) return;
    await applyAtom(ctx.state, { type: '去标记', player: ownerId, markId: '酒/nextKillDamageBonus' });
    return { kind: 'modify', atom: { ...ctx.atom, amount: ctx.atom.amount + 1 } };
  });
  return () => {};
}
```

```ts
// ── 遗计.ts（郭嘉） ──
// 被动技 after hook 用 localVars 与 respond action 通信。
import { registerAfterHook } from '../skill';

export function onInit(skill: Skill, ownerId: number): () => void {
  // respond action:遗计分配牌,设 localVars 记录结果
  registerAction(skill.id, ownerId, 'respond', (state, params) => {
    // validate...
  }, async (state, params) => {
    state.localVars['遗计/allocation'] = params.allocation ?? null;
  });

  registerAfterHook(skill.id, ownerId, '造成伤害', async (ctx) => {
    if (ctx.atom.target !== ownerId) return;
    const amount = ctx.atom.amount;

    for (let i = 0; i < amount; i++) {
      const handBefore = ctx.state.players[ownerId]?.hand.length ?? 0;
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 2 });
      const drawnCards = ctx.state.players[ownerId].hand.slice(handBefore);

      delete ctx.state.localVars['遗计/allocation'];
      await applyAtom(ctx.state, {
        type: '请求回应', requestType: '遗计/distribute', target: ownerId,
        prompt: { type: 'distribute', title: '遗计:分配两张牌', cardIds: drawnCards, minPerTarget: 1, maxPerTarget: 2 },
        timeout: 30,
      });

      const distribution = ctx.state.localVars['遗计/allocation'] as Array<{ target: number; cardIds: string[] }> | null;
      if (Array.isArray(distribution)) {
        for (const entry of distribution) {
          for (const cardId of entry.cardIds) {
            await applyAtom(ctx.state, { type: '给予', cardId, from: ownerId, to: entry.target });
          }
        }
      }
    }
  });
  return () => {};
}
```

```ts
// ── 回合管理.ts(出牌阶段等待示例) ──
export function onInit(skill: Skill, ownerId: number): () => void {
  // ... registerAfterHook(skill.id, ownerId, '回合结束', ...) 启动下一家回合 ...

  registerAction(skill.id, ownerId, 'end',
    (state: GameState, params: Record<string, Json>) => null,
    async (state: GameState, params: Record<string, Json>) => {
      const player = ownerId;
      await applyAtom(state, { type: '阶段结束', player, phase: '出牌' });
      await applyAtom(state, { type: '阶段结束', player, phase: '弃牌' });
      await applyAtom(state, { type: '回合结束', player });
      await applyAtom(state, { type: '下一玩家' });
    },
  );
  return () => {};
}

// 出牌阶段启动(在阶段开始的 after 钩子中):
async function startPlayPhase(ctx: AtomAfterContext) {
  const player = ctx.ownerId;
  await applyAtom(ctx.state, { type: '阶段开始', player, phase: '出牌' });
  await applyAtom(ctx.state, { type: '阶段结束', player, phase: '出牌' });
}
```

```ts
// ── 武圣.ts(关羽·转化技) ──
// 模型见 §3.1:前端两步 UI(选红牌 → 选目标),提交时一个 ClientMessage:
// preceding=[武圣.transform] + 主 action=杀.use。transform 作为 preceding 在 杀.use 之前执行,
// 创建影子卡(cardMap[c1#武圣]={name:'杀',shadowOf:'c1'},手牌引用替换),杀.validate 读
// cardMap[影子id] 看到"杀"通过。主 action validate 失败时 dispatch 调 transform 的 rollback 恢复。
import type { Card, CardWrapper, GameView, GameState, Json, Skill } from '../types';
import { registerAction, type SkillModule } from '../skill';
import { viewCanAttack } from '../viewDistance';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '武圣', description: '你可以将一张红色牌当【杀】使用或打出' };
}

/** 影子卡 id:${原id}#武圣 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#武圣`;
}

export function onInit(skill: Skill, ownerId: number): () => void {
  // transform action:把红色手牌转化为影子"杀"(新建 Card 实体,shadowOf 指向原卡)。
  // 作为 preceding 在 杀.use 之前执行。杀.validate 读 cardMap[影子id] 看到"杀"。
  registerAction(
    skill.id, ownerId, 'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 无 pending + 存活 + 手牌 + 红牌
      const self = state.players[ownerId];
      const cardId = params.cardId as string;
      const card = state.cardMap[cardId];
      const ok = state.currentPlayerIndex === ownerId
        && state.pendingSlots.size === 0
        && self?.alive === true
        && self?.hand.includes(cardId)
        && (card?.suit === '♥' || card?.suit === '♦');
      return ok ? null : '现在不能使用武圣';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const orig = state.cardMap[cardId];
      const sId = shadowIdOf(cardId);
      // 新建影子卡:name='杀',其余属性同原卡,shadowOf 指向原卡(原卡仍在 cardMap)
      state.cardMap[sId] = { id: sId, name: '杀', suit: orig.suit, rank: orig.rank, type: '基本牌', shadowOf: cardId };
      // 手牌:原卡替换为影子卡(玩家"持有"这张杀)
      const self = state.players[ownerId];
      const idx = self.hand.indexOf(cardId);
      if (idx >= 0) self.hand[idx] = sId;
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,手牌还原)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete state.cardMap[sId];
      const self = state.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端 UI 流程:选红牌 → 选目标 → 点武圣按钮
  //   → 提交 preceding=[武圣.transform{cardId}] + 主 action=杀.use{cardId:'c1#武圣',targets}
  api.defineAction('transform', {
    label: '武圣', style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张红色牌当杀使用',
      cardFilter: { filter: (c) => c.suit === '♥' || c.suit === '♦', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1, filter: (v, t) => viewCanAttack(v, api.viewer, t) },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
```

> 杀技能零感知武圣——它看到的永远是 `cardMap` 里的一张"杀"。影子卡离开结算
> (入弃牌堆)时,`移动牌` atom 根据 `shadowOf` 还原为原卡(弃牌堆收原卡 id,删影子条目)。

### 4.11 技能委托

当技能确实需要复用另一个技能的完整 execute 逻辑时，可以直接调用公共函数。但这不是"代理"——两个技能的 validate 各自独立。委托只是代码复用。

### 4.12 引擎技能分类 vs 三国杀技能分类

| 三国杀规则 | 引擎实现 | API |
|---|---|---|
| **锁定技** | `onAtomBefore/After` 无条件执行 | `api.onAtomAfter(atomType, handler)` |
| **主动技** | `registerAction` + validate + execute | `api.registerAction(actionType, def)` |
| **被动技** | `onAtomBefore` 拦截特定 atom | `api.onAtomBefore('询问闪', handler)` |
| **转化技** | 牌包装 + 还原钩子 | `defineAction.transform` + `onAtomAfter('移动牌')` |
| **限定技** | validate 检查 Mark | `validate(...)` + Mark |
| **主公技** | validate 检查身份 | `validate(...)` |


### 4.13 技能加载与生命周期

#### 实例化模型

每个技能**按玩家实例化**。即"杀-P1"和"杀-P2"是两个独立的 Skill 实例，各自拥有独立的 action 注册和钩子。

```
杀-P1: { id: '杀', ownerId: 'P1' }  → registerAction('use', validate(P1), execute(P1))
杀-P2: { id: '杀', ownerId: 'P2' }  → registerAction('use', validate(P2), execute(P2))
八卦阵-P2: { id: '八卦阵', ownerId: 'P2' } → onAtomBefore('询问闪', handler(P2))
```

**为什么卡牌技能也按玩家实例化**：
- `validate` 需要知道"谁的牌"、"谁的出杀次数"——`ownerId` 提供上下文
- `ctx.ownerId` 就是 `ownerId`，钩子中直接判断 `ctx.atom.target !== ctx.ownerId`
- 前端 `defineAction` 的 filter 也需要 `api.viewer`

#### 后端加载流程

```
选将完成，游戏开始
  ↓
for each player:
  for each skillId in player.技能列表:
    1. 通过 skillLoaders[skillId] 动态 import() 技能模块 (skills/${skillId}.ts)
    2. skill = module.createSkill(skillId, player.name)   // 创建实例
    3. module.onInit(skill, player.name)                  // 注册 action/钩子
```
- 技能模块通过 `skills/index.ts` 导出的 `skillLoaders: Record<string, () => Promise<SkillModule>>` 懒加载
- `createSkill` 由引擎调用，传入 `id` 和 `ownerId`，模块返回 Skill 对象
- `onInit` 由引擎紧接着调用，传入 Skill 对象和 ownerId 字符串（非 BackendAPI），返回卸载函数
- 模块本身是**无状态**的工厂，所有状态通过参数和闭包传递
- `onInit` 返回的卸载函数会取消该技能实例的所有 action 注册和 atom 钩子

#### 前端加载流程

前端加载**所有玩家**的技能（需要渲染对手的技能效果，如八卦阵判定动画、无懈可击提示）。但 `defineAction` 只对 viewer 自己可见的技能生效。

```
前端连接/重连，收到初始 GameState（含所有玩家的 skills 列表）
  ↓
for each player:
  for each skillId in player.skills:
    1. 通过 skillLoaders[skillId] 动态 import() 技能模块
    2. skill = module.createSkill(skillId, player.name)
    3. offMount = module.onMount(skill, frontendAPI)       // 注册 UI，返回卸载函数
```

- 前端不调用 `onInit`（tree-shake 掉了）
- `FrontendAPI.viewer` = 当前观察者 ID
- `onEvent`/`playEffect` 是全局的——所有玩家的 atom 事件都会触发（渲染对手的技能效果）
- `defineAction` 只影响 viewer 自己——对手的技能不会给 viewer 显示操作按钮
- `onMount` 返回的卸载函数会取消该技能实例的所有 `defineAction` 注册和 `onEvent` 监听

#### 动态加载与卸载

技能在游戏中可以动态变化。加载/卸载通过 atom 驱动，前后端同步：

**触发场景**：
- **卡牌技能**：卡牌进入/离开手牌（摸牌、弃牌、使用、被拆）
- **装备技能**：装备穿上/卸下（装备、被拆、替换）
- **武将技能变化**：化身（左慈复制技能）、断肠（蔡文姬移除技能）、觉醒技增加技能、死亡移除所有技能

**机制**：

```
加载: apply({ type: '添加技能', player: 'P2', skillId: '八卦阵' })
  → 引擎 import 模块 → createSkill → onInit/onMount
  → player.skills.push('八卦阵')

卸载: apply({ type: '移除技能', player: 'P2', skillId: '反馈' })
  → 引擎调用该技能实例的卸载函数（onInit/onMount 返回值）
  → player.skills.remove('反馈')
  → 所有 action 注册和 atom 钩子被取消
```

- `添加技能`/`移除技能` 是 atom，可重放、可触发其他技能的 hook
- 卸载函数取消所有注册，不需要技能自己维护清理逻辑
- 前端通过收到 `添加技能`/`移除技能` atom 事件同步加载/卸载
- 死亡时批量 `移除技能` 清理该玩家的所有技能实例

#### 前后端加载对比

| | 后端 | 前端 |
|---|---|---|
| **加载范围** | 所有玩家的所有技能 | 所有玩家的所有技能 |
| **调用** | `createSkill` → `onInit` | `createSkill` → `onMount` |
| **卸载** | 调用 `onInit` 返回值 | 调用 `onMount` 返回值 |
| **触发时机** | `添加技能`/`移除技能` atom | 收到对应的 atom 事件 |
| **action 按钮** | 不涉及 | 仅 viewer 自己的技能 `defineAction` 生效 |
| **事件/特效** | 不涉及 | 所有玩家技能的 `onEvent`/`playEffect` 都触发 |

#### action 的 skillId 路由

`ClientMessage { skillId: '杀', actionType: 'use', params, baseSeq }` 中的 `skillId` 是技能 ID（不含 ownerId）。引擎收到后查找 `skillId === '杀' && ownerId === from` 的已注册 action 实例。

### 4.14 回合控制技能

回合控制本身是一个**按玩家实例化**的技能（`回合管理`），不是引擎内建机制。每个玩家启动时挂一份自己的实例，监听 `回合结束` atom，**上家回合结束**则自动开始自己的回合。

**为什么是技能而不是引擎内建流程**：
- 回合控制本质上就是一段业务逻辑（准备→判定→摸牌→出牌→弃牌→回合结束→下一家），与"出杀/出闪"是同构的"按玩家状态推进"
- 实例化后，"谁在什么阶段做什么"由 ownerId 自然决定，引擎不需要存全局的"回合机状态机"
- 技能钩子链（`onAtomAfter('回合结束')`）就是回合传递机制——上家触发 atom，监听者被唤起，无需中心协调
- 可被其他技能干预（觉醒、托管、跳过阶段……）与一般技能无异

**三个组成部分**：

| 组件 | 机制 | 触发 |
|---|---|---|
| **轮到我开始** | `onAtomAfter('回合结束')`：当 `self` 等于"上家下一家"时，自动 `apply(回合开始)` + `apply(阶段开始, 准备)` | 上家玩家 apply 了 `回合结束` atom |
| **主动结束回合** | `registerAction('end')`：玩家点"结束回合"时触发自己回合的结束流程 | 客户端 `ClientMessage { skillId: '回合管理', actionType: 'end' }` |
| **首次开局** | `registerAction('start')`：开局时由主公（`currentPlayerIndex === 0`）触发，唤起第一个回合 | 客户端 `ClientMessage { skillId: '回合管理', actionType: 'start' }` |

**如何确定"上家下一家"**：

```ts
function findNextAlive(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    if (state.players[idx].alive) return idx;
  }
  return fromIndex; // 全死亡,游戏结束
}
```

**典型事件流**（4 人局,P1 → P2 → P3 → P4 → 循环）：

```
开局:P1 触发 start → 回合管理-P1 跑 "回合开始 + 阶段开始(准备)"

P1 点"结束回合":
  回合管理-P1.execute(end):
    apply(阶段结束, P1, 出牌)
    apply(阶段结束, P1, 弃牌)
    apply(回合结束, P1)  ← 触发 after 钩子链
      ↓ onAtomAfter('回合结束'):
        回合管理-P1:  atom.player === self(P1),但此时 ctx.state.currentPlayerIndex
                      还没推进(下一玩家是 P1 自己主动 apply 的)——
                      实际上由 P1.execute 内 apply(下一玩家) 来推进
        回合管理-P2:  自己 = P2,findNextAlive(P1)=P2,匹配 → 启动 P2 回合
        回合管理-P3:  findNextAlive(P1)=P2 ≠ P3,跳过
        回合管理-P4:  findNextAlive(P1)=P2 ≠ P4,跳过
    apply(下一玩家)  ← currentPlayerIndex: P1 → P2
```

**职责切分**：钩子只负责"启动下一家回合"，`apply(下一玩家)` 由**上家 end action execute** 自己推进（`currentPlayerIndex` 的推进是发起者责任），两个角色各管一段——

```ts
// 回合管理-P1.execute('end') — 上家自己推进
async (frame) => {
  const player = frame.from;
  await applyAtom(state, { type: '阶段结束', player, phase: '出牌' });
  await applyAtom(state, { type: '阶段结束', player, phase: '弃牌' });
  await applyAtom(state, { type: '回合结束', player });     // ← 触发所有 after 钩子
  // 钩子链中:回合管理-P2.onAtomAfter 发现自己该接手 → 启动回合
  await applyAtom(state, { type: '下一玩家' });              // ← currentPlayerIndex 推进
}

// 回合管理-P2.onAtomAfter('回合结束') — 被叫到时启动
async (ctx) => {
  const { state, atom } = ctx;
  const finishedIndex = state.players.findIndex(p => p.name === atom.player);
  if (finishedIndex < 0) return;
  // 跳过死亡玩家,找到下一个活着的
  let nextIdx = finishedIndex;
  for (let i = 1; i <= state.players.length; i++) {
    nextIdx = (finishedIndex + i) % state.players.length;
    if (state.players[nextIdx].alive) break;
  }
  if (state.players[nextIdx].name !== ctx.self) return; // 不是我
  await ctx.apply({ type: '回合开始', player: ctx.self });
  await ctx.apply({ type: '阶段开始', player: ctx.self, phase: '准备' });
}
```

**前端 UI**：每个玩家一份 `回合管理` 实例，调用 `defineAction('end', ...)` 和 `defineAction('start', ...)`；前端只对 viewer 自己的实例生效，所以只有"当前行动玩家"会看到"结束回合"按钮（详见 §4.13 前后端加载对比）。

**集成步骤**：

1. 每个玩家在初始 `state.players[i].skills` 中预置 `'回合管理'`（或由开局 `添加技能` atom 触发）
2. `createEngine().bootstrap()` 遍历所有玩家的 skills，调用 `createSkill('回合管理', player.name) → onInit(...)`，为每个玩家实例化
3. 玩家 `end` 走 action dispatch；自动轮转走 `onAtomAfter('回合结束')` 钩子链

**为什么不需要全局的"回合机"**：所有"我现在该做什么"的状态都已经在 atom 流中。`currentPlayerIndex` 指向当前行动玩家；阶段在 `state.phase` 上；`turn.vars` 是当前回合的临时状态。回合管理技能只是把 atom 流串成"一段连续的回合"——纯事件驱动，无中心状态。

## 5. Atom

Atom 是游戏事件——最小的状态变更单元。每个 atom 做两件事：
1. **同步前端**：atom 作为事件推入前端流，前端据此渲染动画、更新 UI
2. **变更状态**：`apply` 是纯函数，修改 GameState

不可再分。技能钩子挂载在 atom 上（§4.5）。

```ts
type Atom =
  // 卡牌/资源
  | { type: '摸牌'; player: number; count: number }
  | { type: '弃置'; player: number; cardIds: string[] }             // 批量弃牌(制衡/弃牌阶段超时等)
  | { type: '移动牌'; cardId: string; from: ZoneLoc; to: ZoneLoc }
  | { type: '获得'; player: number; cardId: string; from?: number }
  | { type: '给予'; cardId: string; from: number; to: number }
  | { type: '装备'; player: number; cardId: string }
  | { type: '卸下'; player: number; slot: EquipSlot }
  | { type: '洗牌' }
  | { type: '重洗' }
  | { type: '整理牌堆'; cards: string[] }
  // 角色状态
  | { type: '造成伤害'; target: number; amount: number; source: number; cardId?: string }
  | { type: '回复体力'; target: number; amount: number; source?: number }
  | { type: '失去体力'; target: number; amount: number }
  | { type: '陷入濒死'; target: number }  // 纯事件标记——体力已扣,等待求桃
  | { type: '击杀'; player: number }  // 玩家死亡(手牌/装备→弃牌堆, alive=false)
  | { type: '设上限'; player: number; amount: number }
  // 标记/状态
  | { type: '加标记'; player: number; mark: Mark }
  | { type: '去标记'; player: number; markId: string }
  | { type: '清过期标记'; player: number }
  | { type: '设横置'; player: number; chained: boolean }
  | { type: '加标签'; player: number; tag: string }
  | { type: '去标签'; player: number; tag: string }
  // 技能管理
  | { type: '添加技能'; player: number; skillId: string }
  | { type: '移除技能'; player: number; skillId: string }
  // 流程
  | { type: '回合开始'; player: number }
  | { type: '回合结束'; player: number }
  | { type: '阶段开始'; player: number; phase: string }
  | { type: '阶段结束'; player: number; phase: string }
  | { type: '设阶段'; phase: TurnPhase }
  | { type: '下一玩家' }
  // 目标(三阶段流程:指定目标 → 成为目标 → 结算)
  | { type: '指定目标'; source: number; cardId?: string; target: number }  // 声明阶段:使用者宣告所有目标,触发"指定目标时"hook
  | { type: '成为目标'; source: number; cardId?: string; target: number }  // 结算阶段:目标正式进入结算,触发"成为目标后"hook(流离/激昂等),before hook 可被 cancel(空城/帷幕/谦逊)
  // 判定
  | { type: '判定'; player: number; judgeType: string }
  | { type: '添加延时锦囊'; player: number; trick: PendingTrick }
  | { type: '移除延时锦囊'; player: number; trickName: string }
  // 拼点
  | { type: '拼点'; initiator: number; target: number; initiatorCard: string; targetCard: string }
  // 初始化(由 开局 skill 在 bootstrap 阶段使用)
  | { type: '抽身份'; playerCount: number; seed: number }
  | { type: '选将'; characters: Array<{ name: string; skills: string[] }>; seed: number }
  | { type: '选将询问'; target: number; candidates: Array<{ name: string; skills: string[] }>; prompt?: ActionPrompt }
  | { type: '并行选将'; selections: Array<{ target: number; candidates: Array<{ name: string; skills: string[] }> }> }
  | { type: '分配武将'; target: number; character: string; skills: string[] }
  | { type: '初始化洗牌'; seed: number }
  | { type: '发牌'; handSize: number; lordBonus?: number }
  // 等待回应(进入 pending 区,等待玩家操作或超时)
  | { type: '询问闪'; target: number; source: number }
  | { type: '询问杀'; target: number; source: number }
  | { type: '请求回应'; requestType: string; target: number; prompt: ActionPrompt; defaultChoice?: Json; timeout?: number; cancelTarget?: number }
  | { type: '并行回应'; requestType: string; targets: number[]; prompt: ActionPrompt; defaultChoice?: Json; timeout?: number }  // 多目标并行盲选(拼点):为每个 target 创建独立 slot
  // 牌包装(武圣转化,仅由 武圣 skill 使用)
  | { type: '武圣包装'; cardId: string }
  | { type: '武圣还原'; cardId: string };
```

**设计约定**:

- **座次下标代替字符串 ID**:所有 `player`/`target`/`source` 字段是 `number`(座次下标),不是 `'P1'`/`'P2'` 字符串。引擎只认座次,玩家名由 session 层映射。
- **`ZoneLoc`**(移动牌的 from/to):`{ zone: '牌堆' | '弃牌堆' | '处理区' } | { zone: '手牌'; player: number }`。
- **出牌阶段等待**:不设独立的 `等待出牌` atom——出牌阶段用 `请求回应`(requestType=`__弃牌` 等)承载,复用同一 pending 机制。
- **出杀次数**:不设 `增量变量` atom——由 `slash-quota.ts` 的 `canSlash/incSlashUsed` 管理(查询型提供者模式,见 §4.10 杀示例),状态存 `turn.vars['杀/usedCount']`。
- **`武圣包装`/`武圣还原`**:这两个 atom 类型仅服务于武圣转化(在 `移动牌` 进出处理区时由技能 after hook 调用)。目前作为具名 atom 存在是历史成因;新转化技不应再新增同类 atom,应走 `preceding` action + 影子卡机制(§3.1)。

interface AtomDefinition<A = unknown> {
  type: string;

  // ── 后端 ──

  /** 验证：这个 atom 在当前 state 下合法吗？返回 null = 合法 */
  validate(state: GameState, atom: A): string | null;

  /** 执行：修改 state（原地突变） */
  apply(state: GameState, atom: A): void;

  /**
   * 可选:等待配置。有此字段 = 等待型 atom。
   * apply 流程走完后进入 pending 区,Promise 挂起,等用户操作或超时。
   * 等待型 atom 不可被取消——必走完(响应/超时)之一(没有 `drop()` 机制)。
   */
  pending?: {
    /**
     * 超时后的行为:一个 async 函数,引擎在 slot 超时时调用。
     * 内部可自由编排 applyAtom(支持多步操作),每个 applyAtom 照常走完整 pipeline(hooks 正常触发)。
     * **必填**——典型场景是 `async () => {}`(超时不做事,继续结算)。
     */
    onTimeout: (state: GameState, atom: Atom) => Promise<void>;
    /** 前端提示(告诉前端渲染什么 UI) */
    prompt: ActionPrompt;
    /** 超时秒数。**必填**——无合理默认值,常见值:询问闪/询问杀 15s,请求回应 30s
     * 运行时:优先读 atom 字段 `timeout`(如 `请求回应` 的 `timeout` 参数),fallback 到 def.pending.timeout。
     * 这样可以在创建等待型 atom 时动态指定超时,不被 def 的默认值锁定。
     */
    timeout: number;
  };

  // ── 前端视图 ──

  /**
   * ⚠️ **在 apply 之前调用**——此时 state 尚未变更，可以读取即将被消费的数据
   * （如摸牌前读取牌堆顶的牌面信息）。
   *
   * 后端 atom 含完整信息（牌 ID、zone 引用等），不适合直接推前端：
   * 1. 信息泄漏——摸牌对本人显示牌面，对其他人只显示数量
   * 2. 语义不匹配——后端 `{ type: '移动牌', from: 手牌, to: 弃牌堆 }`，
   *    前端需要的是 `{ type: '弃牌', card: { name: '杀', suit: '♠', rank: 7 } }`
   *
   * 返回 ViewEventSplit，ViewEvent 是纯数据（可序列化）。
   * 不实现 = fallback 到带 effect 的原始 atom（前端回退到全量 buildView）。
   */
  toViewEvents?(state: GameState, atom: A): ViewEventSplit | undefined;

  /**
   * 前端视图状态更新。与后端 apply 对称——apply 修改 GameState，applyView 修改 GameView。
   *
   * 前端收到 ViewEvent 后，按 `event.atomType ?? event.type` 查找此 AtomDefinition，
   * 调用 applyView 增量更新 GameView。
   * 未实现 = 前端回退到全量 buildView。
   */
  applyView?(view: GameView, event: ViewEvent): void;

  /** 可选：视觉/音效反馈声明。仅在 toViewEvents 未实现时作为 fallback 使用。 */
  effect?: AtomEffect;
}
```

### 5.1 Atom 列表设计原则

+ **每个 atom 对应一个游戏事件**——前端需要渲染的"发生了什么"
+ **每个 atom 是一次状态变更**——`apply` 确实修改 GameState
+ **不需要的 atom 已删除**:
  - `累计出杀`、`设置变量`、`增加变量`、`清空变量`、`设置上下文变量`:技能状态走 `turn.vars`/`player.vars`/`localVars`,不需要全局 atom。出杀次数由 `slash-quota.ts` 的 `canSlash/incSlashUsed` 管理(查询型提供者模式),状态存 `turn.vars['杀/usedCount']`。
  - `解决`、`出牌`:技能内部流程,不是独立游戏事件
  - `杀命中`、`杀被闪避`:杀技能的内部结果分支,通过检查处理区/弃牌堆判断
  - `等待出牌`、`等待弃牌`:出牌/弃牌阶段等待用 `请求回应`(requestType=`__弃牌`)承载,复用同一 pending 机制,不设独立 atom

```ts
/** 动画/音效——前后端定义放一起，方便维护和扩展 */
interface AtomEffect {
  /** 播放的音效 ID */
  sound?: string;             // 'slash_hit' | 'dodge' | 'damage_fire' | 'heal' | ...
  /** 角色动画 */
  animation?: string;         // 'shake' | 'flash' | 'flip' | 'slide' | ...
  /** 全屏效果 */
  screenEffect?: string;      // 'shake' | 'flash_red' | 'lightning' | ...
  /** 粒子效果 */
  particles?: string;         // 'fire' | 'thunder' | 'ice' | 'blood' | ...
  /** 动画时长（毫秒），0 = 无动画 */
  duration?: number;
  /** 音量（0-1） */
  volume?: number;
  /** 是否等待动画结束再继续处理（前端阻塞） */
  blockUntilDone?: boolean;
}
```

前端工作流：
1. 收到新的 `ViewEvent`，前端 reducer 增量更新 `GameView`
2. 按 `effect` 声明播放动画/音效
3. 如果 `blockUntilDone` = true，等待动画结束再更新 UI 状态

示例：
- **造成伤害**：`toViewEvents` → 本人看到 `{ type: '造成伤害', target: 'P2', amount: 1, source: 'P1', effect: { ... } }`
- **摸牌**：`toViewEvents` → 本人看到 `{ type: '摸牌', player: 'P1', cards: [{ name: '杀', suit: '♠', rank: 7 }] }`，其他人看到 `{ type: '摸牌', player: 'P1', count: 2 }`
- **移动牌**（手牌→弃牌堆）：`toViewEvents` → `{ type: '弃牌', player: 'P1', card: { name: '闪', suit: '♥', rank: 3 } }`
- **指定目标**：`toViewEvents` → `{ type: '指定目标', source: 'P1', target: 'P2' }`
- **询问闪**：`toViewEvents` → `{ type: '询问闪', target: 'P2', pending: { ... }, effect: { blockUntilDone: true } }`

Atom 不知道为什么被调用、谁在调用。`validate` 做数据级检查（"target 存不存在"），`apply` 做状态变更（"扣血"），`toViewEvents` 做前端展示（"扣血动画 + 脱敏参数"）。三者同文件定义，修改 atom 时不会忘改效果。

### 5.2 ViewEvent——前端视图事件

`ViewEvent` 是前端实际消费的事件，由 `AtomDefinition.toViewEvents` 从后端 atom 转换而来。
**ViewEvent 是纯数据——可序列化，跨网络传输，不含函数。**
```ts
/**
 * 前端视图事件——后端 atom 的前端投影。纯数据，可序列化。
 *
 * 与后端 Atom 的区别：
 * 1. 参数脱敏：不含 cardId 引用（前端用 cardMap 查），不含 zone 内部引用
 * 2. 信息分级：摸牌对本人暴露牌面，对他人只给数量
 * 3. 语义对齐：后端 `移动牌` 对应前端 `弃牌`/`出牌`/`摸牌` 等语义化事件
 * 4. 自带 effect：动画/音效声明内联，前端不需要按 type 查表
 * 5. atomType：当 ViewEvent.type 与 atom.type 不同时，携带原始 atom 类型
 */
interface ViewEvent {
  /** 事件类型（可能与 atom type 不同，如 移动牌→弃牌） */
  type: string;
  /**
   * 原始 atom 类型。当 ViewEvent.type 与 atom.type 不同时自动设置，
   * 前端据此查找 AtomDefinition.applyView。
   * 相同时省略（前端 fallback 到 type）。
   */
  atomType?: string;
  /** 事件数据（已脱敏，只含前端需要的字段） */
  [key: string]: Json;
  /** 内联动画/音效声明（可选） */
  effect?: AtomEffect;
  /** 等待信息（仅等待型 atom） */
  pending?: { startTime: number; deadline: number; prompt: ActionPrompt };
}

/**
 * Per-player 视图分叉——替代旧的 AtomPlayerViews 元组。
 *
 * ownerViews: 指定玩家看到专属的视图事件（如摸牌看到具体牌面）
 * othersView: 其余玩家看到的通用视图事件（如摸牌只看到数量）
 *
 * null = 该角色看不到此事件（如对方的加标签）
 */
interface ViewEventSplit {
  /** 指定玩家看到的专属视图事件 */
  ownerViews: ReadonlyMap<string, ViewEvent | null>;
  /** 其余玩家看到的通用视图事件。null = 其他人不感知此 atom */
  othersView: ViewEvent | null;
}
```

**`applyView` 不在 ViewEvent 上——它在 AtomDefinition 上**。ViewEvent 是后端生成的纯数据，通过网络序列化传给前端；`applyView` 是前端逻辑，在前端按 `event.atomType ?? event.type` 查找 AtomDefinition 后调用。

**旧 `toPlayerViews` / `AtomPlayerViews` 已删除**。替代方案：

| 旧 | 新 | 变化 |
|---|---|---|
| `toPlayerViews(state, atom): [Map<string, Atom>, Atom \| null]` | `toViewEvents(state, atom): ViewEventSplit` | 返回前端语义化的 ViewEvent，不是原始 Atom |
| `AtomPlayerViews` 元组 | `ViewEventSplit` | `ownerViews` 值可为 null（隐藏），`othersView` 也可为 null |
| `AtomDefinition.effect` | `ViewEvent.effect` 内联 | effect 成为 ViewEvent 的字段，不再按 type 查表 |
| 前端按 atom.type 查 effect 表 | 前端直接读 ViewEvent.effect | 消除前端查表逻辑 |
| `view/reducer.ts` 300+ 行 switch-case | `AtomDefinition.applyView` | 前端 reducer 按 `atomType` 查找 def，调用 `def.applyView(view, event)` |

#### 前端消费管线

```ts
// 前端 reducer —— 不再需要巨型 switch-case
function viewReducer(view: GameView, event: ViewEvent): GameView {
  // 1. 按 atomType 查找 AtomDefinition，调用其 applyView
  const def = getAtomDef(event.atomType ?? event.type);
  def.applyView?.(view, event);
  // 2. 播放动画/音效
  if (event.effect) {
    playEffect(event.effect);
  }
  return view;
}

// 前端收到事件流后
for (const event of viewEvents) {
  gameView = viewReducer(gameView, event);
}
```

若 AtomDefinition 没有 `applyView`（如 fallback 路径），前端回退到全量 `buildView()`。

## 6. 执行模型

### 6.1 apply(atom) 执行流程

当技能代码调用 `await applyAtom(state, atom)` 时，**所有 atom 走同一条路径**——无论是否等待型：

1. **压栈**：atom 压入当前帧的 atom 栈
2. **onBefore hooks**(折叠语义):所有注册了该 `atomType` 的 before 钩子按注册顺序(座次序)串行执行(async)
   - 钩子可以 `await applyAtom(ctx.state, 新atom)` 形成嵌套(包括嵌套等待型 atom)
   - 钩子返回 `HookResult`:`pass`(默认)/`modify`(修改参数,后续钩子看到新值,叠加)/`cancel`(终止,atom 不进入 validate/apply/after,推 notify)
   - `cancel` 后后续 before 钩子不再跑;`modify` 叠加(藤甲 -1 → 白银狮子看到减过的伤害)
3. **validate**：`AtomDefinition.validate(state, atom)` → 不合法则跳过，Promise resolve
4. **生成视图事件**：调用 `AtomDefinition.toViewEvents(state, atom)` 生成分叉视图事件 → 推入前端事件流。
   - ⚠️ **在 apply 之前**——此时 state 尚未变更，可以读取即将被消费的数据（如牌堆顶的牌面信息）
   - 每个 ViewEvent 可附带 `applyView` 函数，前端 reducer 据此增量更新 GameView
   - 若 `toViewEvents` 未实现，fallback 为带 `AtomDefinition.effect` 的原始 atom（无 applyView）
5. **apply**：`AtomDefinition.apply(state, atom)` → 产生新 state（纯函数）
6. **弹栈**：atom 从 atom 栈弹出
7. **onAfter hooks**：所有注册了该 `atomType` 的 `onAtomAfter` 钩子按优先级串行执行（async）
   - 钩子可以 `await applyAtom(ctx.state, 新atom)`
   - 钩子通过 `ctx.state` 读 state(只读)
8. **检查 pending**（仅当 `AtomDefinition.pending` 存在时）：
   - **若当前已有 pending slot**:旧 slot 的 Promise **直接 resolve**(不 fire onTimeout,旧 atom 已被新 wait 取代),旧 atom 已应用的 state 变更保留
   - 新 atom 进入 **pending 区**，`applyAtom` 返回的 Promise **挂起**
   - 前端收到带 `pending: { startTime, deadline }` 的 atom 事件
**原子性保证**：before 钩子通过返回 `HookResult`(§4.5)干预当前 atom:`modify` 改参数(叠加生效)、`cancel` 取消。validate 在钩子折叠之后执行,基于(可能被 modify 过的)最新参数检查。
   - 等待结束: 响应到达(target 的 respond action execute 完,slot 被消费)或 超时(`pending.onTimeout` async 函数被调用,必填)


**普通 atom vs 等待型 atom 的唯一区别**：步骤 8。没有 `pending` 声明的 atom 在步骤 7 后 Promise 直接 resolve；有 `pending` 声明的 atom 进入 pending 区等待。

```
// 杀的 execute 流程(技能显式创建的帧,params 只读)
pushFrame(state, '杀', from, { cardId, targets })

// 移牌到处理区
await applyAtom(state, { type: '移动牌', cardId, from: 手牌, to: 处理区 })

await applyAtom(state, { type: '指定目标', source: 0, target: 1 })

// 询问闪:等待型 atom → 进入 pending 区 → Promise 挂起
await applyAtom(state, { type: '询问闪', target, source: 0 })
// ↑ 八卦阵 before 钩子:
//    插入 请求回应(是否发动八卦阵) → 用户选择 → 判定
//    判定成功 → apply(加标签, autoDodge) → 询问闪继续
//    判定失败 → 不做事 → 询问闪继续
// ↑ 询问闪进 pending 区后:
//    用户出闪 → 闪 action execute(移牌到弃牌堆) → pending 消费 → Promise resolve
//    或超时 → onTimeout 为空函数 → Promise resolve

// Promise resolve 后,父 action 观察 state.zones.discardPile 增量判断闪避
const beforeCount = ...; // 等待前快照
// ↑ 询问闪后
const dodged = state.zones.discardPile.slice(beforeCount)
  .some(id => state.cardMap[id]?.name === '闪');
if (!dodged && !hasTag('八卦阵/autoDodge')) {
  await applyAtom(state, { type: '造成伤害', target, amount: 1, source: 0 });
}
// 移牌到弃牌堆
await applyAtom(state, { type: '移动牌', cardId, from: 处理区, to: 弃牌堆 })
```

### 6.2 Pending 区

Pending 区存放当前正在等待玩家操作的 atom。**同时只有一个等待**——新等待进入时,旧等待的 Promise 直接 resolve(不 fire onTimeout,见 §6.1 步骤 8)。

```ts
interface PendingSlot {
  /** 等待中的 atom */
  atom: Atom;
  /** 该 atom 的 AtomDefinition(含 pending 配置) */
  definition: AtomDefinition;
  /** 等待开始的相对时间 */
  startTime: number;
  /** 超时截止的相对时间 */
  deadline: number;
  /** Promise 的 resolve 函数——消费/超时时调用 */
  resolve: () => void;
  /** 超时定时器 ID */
  timer: NodeJS.Timeout;
}
```

+ **入队**: 等待型 atom 的 apply 流程走完后,从 atom 栈弹出,进入 pending 区(若已有旧 slot,旧 slot 立即被替换,见 §6.1)
+ **消费**: 用户发 action → action execute → pending 被消费 → `resolve()` → 技能的 `await applyAtom(state, ...)` 从暂停点恢复
+ **超时**: 定时器触发 → `clearTimeout(timer)` → 执行 `pending.onTimeout`(必填)async 函数 → `resolve()` → 技能恢复
+ **没有 `drop()` 清除机制**——等待型 atom 必走完(消费/超时)之一

**嵌套等待**: before hook 中可以 `await applyAtom(ctx.state, 等待型atom)` 插入新的等待。此时外层 atom 还在 apply 栈上没弹出,内层等待型 atom 先执行完其 apply 流程,先进入 pending 区。内层被消费后,外层 atom 的 before hooks 继续——外层 atom 继续执行其 apply 流程,也进入 pending 区(若内层是替换进来的,旧 slot 也已 resolve)。

### 6.3 超时配置

`AtomDefinition.pending.timeout` **必填**(无合理默认值——隐藏 30s、超时不做事 = 挂死,都不可接受)。常见值:
+ 询问闪 / 询问杀: 15 秒
+ 请求回应(技能确认/分配): 30 秒

未来扩展(本 PR 不做):玩家级配置(生手加思考时间)按 `timeout × multiplier` 调整。

### 6.4 注册表

```ts
interface AtomHookEntry {
  skillId: string;
  ownerId: number;  // 座次下标
  atomType: string;
  phase: 'before' | 'after';
  /** before 钩子可返回 HookResult(pass/modify/cancel);after 钩子返回 void */
  handler: (ctx: AtomBeforeContext | AtomAfterContext) => Promise<HookResult | void>;
}

interface ActionEntry {
  skillId: string;
  ownerId: number;  // 座次下标
  actionType: string;
  validate: (state: GameState, params: Record<string, Json>) => string | null;
  execute: (state: GameState, params: Record<string, Json>) => Promise<void>;
  /** 可选:回滚 execute 的副作用。仅"可组合 action"(用于 preceding)需要实现 */
  rollback?: (state: GameState, params: Record<string, Json>) => void;
}
```

+ **Atom hook**:副作用语义,所有匹配的都执行。before 可返回 `HookResult`(pass/modify/cancel),after 是纯副作用(返回 void)
+ **Action**:唯一匹配(`skillId + ownerId + actionType` 三元组),纯路由,不支持钩子

## 7. GameState

```ts
interface GameState {
  /** 玩家数组，索引 = 座次。players[0] = 主公座位 */
  players: PlayerState[];
  /** 当前行动玩家索引 */
  currentPlayerIndex: number;
  /** 当前阶段 */
  phase: TurnPhase;
  /** 回合状态（切换回合/阶段时自动清理，见 §7.3） */
  turn: TurnState;

  /** 牌区 */
  zones: {
    /** 牌堆(牌 ID 列表,末尾 = 堆顶) */
    deck: string[];
    /** 弃牌堆 */
    discardPile: string[];
    /** 处理区(结算中的牌) */
    processing: string[];
  };
  /** 结算区栈。主动 action 压入新帧，回应 action 共享栈顶 */
  settlementStack: SettlementFrame[];
  /**
   * 牌定义查找表。key = cardId，贯穿整局游戏不变。
   * 手牌/装备/弃牌堆等位置只存 ID，需要属性（名称/花色/点数）时通过 cardMap 查。
   */
  cardMap: Record<string, Card>;
  /** RNG 种子（确定性随机） */
  rngSeed: number;

  /** 服务端 action 日志（用于重放） */
  actionLog: ActionLogEntry[];

  /** Mark 体系：所有持续状态 */
  marks: Mark[];
  /**
   * 全局上下文变量。跨 atom 共享的中间状态（如判定结果 baguaJudgeResult）。
   * 钩子之间通过 localVars 传递数据，用 `hookId:key` 做 namespace 避免冲突。
   */
  localVars: Record<string, Json>;
  /** 元信息 */
  meta: GameMeta;
  /** CAS 序列号，详见 §7.6 */
  seq: number;
  /** 游戏开始时刻（毫秒偏移），所有 timestamp 相对于此 */
  startedAt: number;
}
```

### 7.1 玩家

```ts
interface PlayerState {
  /** 座位索引（= 数组下标，不可变） */
  index: number;
  /** 玩家名称 */
  name: string;
  /** 角色名（如 '曹操'） */
  character: string;
  health: number;
  maxHealth: number;
  alive: boolean;

  /** 手牌 ID 列表 */
  hand: string[];
  /** 装备区 */
  equipment: Partial<Record<EquipSlot, string>>;
  /** 判定区的延时锦囊 */
  pendingTricks: PendingTrick[];
  /** 已拥有的技能 ID 列表 */
  skills: string[];

  /**
   * 玩家私有变量。按 scope 命名：
   * - '裸衣/active'：技能开关
   * - '马术/距离修正'：距离修正
   * - 'xxx/usedThisTurn'：每回合自动清理
   */
  vars: Record<string, Json>;
}
```

`players` 是数组，索引即座次。计算距离 = `min(|i - j|, N - |i - j|)`。不再需要 `playerOrder`。

### 7.2 变量作用域

| 变量 | 位置 | 生命周期 | 用途 |
|---|---|---|---|
| `state.localVars` | GameState | 跨 atom 持久，回合结束可清理 | 钩子间传递中间状态（判定结果） |
| `player.vars` | PlayerState | 跨 atom 持久，按 key 后缀自动清理 | 玩家私有状态（技能开关、距离修正） |

### 7.3 自动清理

回合/阶段切换时自动清理过期变量，避免手动管理：

```ts
interface TurnState {
  /** 当前回合数（从1开始） */
  round: number;
  /** 当前阶段 */
  phase: TurnPhase;
  /**
   * 技能自定义回合数据。key 由技能 namespace（如 '杀/killsPlayed'）。
   * 引擎不解释内容，只在回合结束时整体清空。
   */
  vars: Record<string, Json>;
}
```

技能通过 `state.turn.vars['杀/killsPlayed']` 读写自己的回合数据。引擎在回合结束时清空 `turn.vars`，技能不需要手动清理。

自动清理规则：
- **回合结束**：清空 `turn.vars`；清理所有玩家 `vars` 中 key 以 `/usedThisTurn` 结尾的变量；清理 `localVars` 中钩子 namespace 下的临时数据
- **阶段切换**：按需清理（如弃牌阶段结束清理弃牌相关临时数据）
- **Mark 过期**：检查 `duration` 字段，`'turn'` = 回合结束过期，`'round'` = 一轮结束过期，`number` = N 个回合后过期

### 7.4 Mark 体系

所有"持续状态"都是 Mark，不走 PlayerState 独立字段：

```ts
interface Mark {
  id: string;       // 'chained' | 'faceDown' | 'cannotDodge' | ...
  scope: number;    // 玩家索引（-1 = 全局）
  payload?: Json;
  duration?: 'turn' | 'round' | number;
}
```

### 7.5 相对时间

所有时间戳使用**相对于游戏开始的偏移量**（毫秒），不存绝对时间：

- `startedAt`：游戏开始时的 `Date.now()`，存一次
- `ActionLogEntry.timestamp`：`Date.now() - state.startedAt`
- `pending.deadline`：相对于 `startedAt` 的偏移

好处：重放时不受系统时钟影响，可加速/暂停；存档跨时区一致；测试可完全确定性。

### 7.6 CAS 序列号

`seq` 是全局单调递增计数器，每次 action 执行时 +1。用于解决多人并发操作的状态同步问题。

**问题**：多个玩家可能在同一响应窗口并发响应（如无懈可击链）。客户端发操作时看到的是某个 state 快照；请求到达服务端前，服务端可能已因别的玩家操作而推进。基于旧快照的决策在新状态下可能不合法。

**机制**：

```
客户端                                      服务端
  │                                          │
  │  ClientMessage { baseSeq: 5, ... }  ──→  │
  │                                          │  CAS: state.seq === 5 ? ✓ : ✗
  │                                          │  ✓ → 处理操作，seq 推进到 6
  │  ←──  events [{ seq: 6, ... }]          │
  │                                          │
  │  ClientMessage { baseSeq: 3, ... }  ──→  │
  │                                          │  CAS: state.seq === 3 ? ✗ (当前是 6)
  │                                          │  静默丢弃，不返回错误
  │  ←──  events [其他玩家操作导致的更新]      │
```

1. `ClientMessage` 携带 `baseSeq`：客户端发出操作时附上当前看到的 `seq` 值
2. 服务端 CAS 校验：`baseSeq !== state.seq` 时**静默丢弃**，不发 error
3. 客户端通过后续 events 推送自动看到最新状态，旧操作自然"消失"
4. `validate` 是第二道关卡：CAS 通过后仍会拦截"操作本身非法"

**为什么静默丢弃**：CAS 失败的本质是"状态已推进，旧操作无意义"，不是错误。前端不需要弹错提示。

**seq 推进时机**：每次 action 开始执行时 `seq++`。

**断线重连**：服务端按玩家存前端事件流，客户端 ack 序号。重连后推送 lastAck 之后的事件差量。

## 8. 日志

### 8.1 Action 日志（后端持久化）

```ts
interface ActionLogEntry {
  /** 全局单调递增 ID */
  id: string;
  /** 相对时间戳（毫秒，相对于 startedAt） */
  timestamp: number;
  /** 客户端消息 */
  message: ClientMessage;
  /** action 执行前的 state.seq（用于重放校验） */
  baseSeq: number;
}
```

后端存 `actionLog: ActionLogEntry[]`。重放 = 从初始 state + actionLog 重新执行所有 action，恢复到最新 state。不存 atom——atom 是执行过程的中间产物。

### 8.2 前端事件流

前端收到的是 **视图事件流**（`ViewEvent[]`），由 `AtomDefinition.toViewEvents` 从后端 atom 转换而来。每个 action 执行后，引擎收集所有生成的 ViewEvent，session 层按 player 做 per-player 分叉广播。

### 8.2.1 事件生成管线

```
后端 atom                     ViewEvent（per-player 分叉）
─────────────────────────     ──────────────────────────────────
{ type: '摸牌',              owner(P1): { type: '摸牌', player: 'P1',
  player: 'P1', count: 2 }       cards: [{ name: '杀', ... }, { name: '闪', ... }],
                                  effect: { sound: 'draw' } }
                              others:   { type: '摸牌', player: 'P1', count: 2,
                                  effect: { sound: 'draw' } }

{ type: '造成伤害',           all: { type: '造成伤害', target: 'P2', amount: 1,
  target: 'P2', amount: 1,       source: 'P1',
  source: 'P1' }                 effect: { sound: 'damage_physical', animation: 'shake' } }

{ type: '移动牌',             owner(P1): { type: '弃牌', player: 'P1',
  from: 手牌(P1),                 card: { name: '闪', suit: '♥', rank: 3 },
  to: 弃牌堆 }                    effect: { sound: 'discard' } }
                              others:   { type: '弃牌', player: 'P1',
                                  card: { name: '闪', suit: '♥', rank: 3 },
                                  effect: { sound: 'discard' } }
```

### 8.2.2 传输协议

```ts
/** 服务端推给单个客户端的消息 */
type ServerEventMessage = {
  type: 'events';
  fromSeq: number;
  /** 该玩家可见的视图事件列表 */
  events: ViewEvent[];
};
```

Session 层在 `broadcastNewState()` 中：
1. 从引擎事件流获取本批次所有 `ViewEventSplit`
2. 遍历每个玩家，收集其可见的 ViewEvent（`ownerViews.get(name) ?? othersView`）
3. 发送 `{ type: 'events', fromSeq, events }` 给该玩家

### 8.2.3 前端消费

前端维护一个 `GameView` 状态机，收到 `ViewEvent[]` 后增量更新。
前端按 `event.atomType ?? event.type` 查找 AtomDefinition，调用其 `applyView`：

```ts
// 前端 reducer —— 不需要巨型 switch-case
function viewReducer(view: GameView, event: ViewEvent): GameView {
  // 1. 按 atomType 查找 AtomDefinition，调用其 applyView
  const def = getAtomDef(event.atomType ?? event.type);
  def.applyView?.(view, event);
  // 2. 播放动画/音效
  if (event.effect) {
    playEffect(event.effect);
  }
  return view;
}

// 前端收到事件流后
for (const event of viewEvents) {
  gameView = viewReducer(gameView, event);
}
```

**设计决策**：`applyView` 在 AtomDefinition 上而非 ViewEvent 上。
ViewEvent 是后端生成的纯数据，通过网络序列化传给前端——函数不能序列化。
`applyView` 是前端逻辑，前端共享 atom 定义代码（tree-shake 后端的 validate/apply），
按 `atomType` 查找 AtomDefinition 后调用 `applyView(view, event)`。

`atomType` 由 `resolveViewEvents` 在后端自动设置——当 ViewEvent.type 与 atom.type 不同时
（如 `移动牌` → `弃牌`），确保前端能找到原始 AtomDefinition。

若 AtomDefinition 没有 `applyView`（如 fallback 路径），前端回退到全量 `buildView()`。

### 8.2.4 断线重连与回放

服务端按玩家存事件流（用于断线重连推差量），客户端 ack 序号。
事件流不持久化到 action 日志——它是 action 执行的副产物，可以从 action 日志重新生成。

## 9. 文件结构

```
src/engine/
  atom.ts              # atom 定义注册 + apply 实现
  skill.ts             # 技能注册表 + skillLoaders + registerAction/registerBeforeHook/registerAfterHook
  atom-registry.ts     # atom 注册表
  event-stream.ts      # 前端事件流管理（per-player）
  types.ts             # 所有类型定义
  create-engine.ts     # 引擎主入口(create/bootstrap/dispatch/buildView/fireTimeout/resetForTest) + 原属 engine-api.ts 的导出(applyAtom/pushFrame/popFrame/pushNotify 等)
  atoms/               # atom 定义（每个文件一个 atom）
    受伤.ts
    摸牌.ts
    ...

  cards/               # 卡牌定义（每个文件一类卡牌）
    characters/        # 武将卡牌定义（每个文件一个卡牌）
      刘备.ts
      ...

    基础.ts
    锦囊.ts
    ...

  skills/              # 技能定义（每个文件一个技能，通过 index.ts 的 skillLoaders 懒加载）
    index.ts           # skillLoaders: Record<string, () => Promise<SkillModule>>
    杀.ts              # 主动技能（registerAction）
    桃.ts
    无中生有.ts
    遗计.ts            # 锁定技（registerAfterHook）
    反馈.ts
    八卦阵.ts          # 被动技（registerBeforeHook）
    ...

  view/
    reducer.ts          # 客户端视图更新（事件驱动）

src/server/
  session.ts            # 网络会话，结算栈超时/resume
  protocol.ts           # ClientMessage 定义
```

## 10. 不存在的东西

| 已删除 | 原因 |
|---|---|
| `GameAction` | 统一为 `ClientMessage { skillId, actionType, params }` |
| `ServerEvent` / `PlayerEvent` | 统一为 `GameEvent`（atom + notify） |
| `card-handlers.ts` | 卡牌使用是技能的 action |
| `SkillPhase` / `OrchestrationFrame` | 技能直接用 async/await 控制流程 |
| `推入待定` / `弹出待定` atom | 统一为 atom awaits + 结算区栈 |
| `resumeHook` 重入机制 | 异步钩子直接 `await` 等结果 |
| `emitEvent` / `registerCharacterTriggers` | v2 已清除 |
| `applyAtomsAsync` / `AsyncEngine` | 不再需要，async/await 取代 |
| `MAX_HOOK_RECURSION` | 异步不会栈溢出，设安全上限即可 |
| `skipHooks` 参数 | 不再需要 |
| `AtomLogEntry` / `serverLog` | 改为 `ActionLogEntry` + `actionLog` |
| `累计出杀` atom | 技能状态走 `turn.vars`,由 `slash-quota.ts` 的 `canSlash/incSlashUsed` 管理(查询型提供者模式),不需要全局 atom |
| `设置变量`/`增加变量`/`清空变量`/`设置上下文变量` atom | 技能状态走 `turn.vars`/`player.vars`/`localVars`,不需要全局 atom |
| `成为目标`（旧设计为单一时机事件）| 保留并拆分为 `指定目标`（声明阶段）+ `成为目标`（结算阶段）两个独立 atom——视角通过原子类型而非钩子条件区分，且支持 cancel（空城等拦截） |
| `解决`/`出牌` atom | 技能内部流程步骤，不是独立游戏事件 |
| `杀命中`/`杀被闪避` atom | 杀技能内部结果分支，通过结算帧 params 判断 |
| `AtomHookContext` | 拆分为 `AtomBeforeContext`(可返回 HookResult)和 `AtomAfterContext`(纯副作用) |
| `ActionContext` | 改为 `SettlementFrame`(结算帧) |
| `requestStack` | 合并进 `SettlementFrame.pendingRequest` |
| `actionStack` | 改为 `settlementStack` |
| `setResult` / `cancel` / `dropAtom` / `ctx.drop()` | 统一为 `HookResult`(`pass`/`modify`/`cancel`),before 钩子返回值。`dropAtom` 本身也已删除——取消语义完全由 `HookResult.cancel` 表达 |

| `atom.result` 字段 | atom 不携带结果，结算全看帧 params |
| `modifyParams` API | 已删除——frame.params 配置字段只读;跨 atom 通信走 state 观察(zones/tags/marks/localVars),结算目标改写走 params 的可变字段(§4.3) |
| `ctx.drop()` | 已删除——取消语义由 before 钩子返回 `{ kind: 'cancel' }` 表达 |
| `GameState.activeContexts` | 已删除——Promise 链自管理,运行时不需要额外跟踪 |
| `EngineApi.drop()` | 已删除——同 `ctx.drop()`,取消语义走 `HookResult.cancel` |
| `frame.consumePending()` | 已删除——pending 消费由引擎自动驱动(target respond action execute 完自动 resolve) |
| `frame.apply` / `frame.notify` | 已删除——SettlementFrame 是纯数据,所有操作走顶层函数 `applyAtom` / `pushNotify` |
| `BackendAPI` / `EngineApi` | 已删除——技能直接 import 顶层函数,不需要闭包对象 |
| `createEngineApi` | 已删除——从未使用 |
| `getCurrentState()` / `getCurrentOwnerId()` | 已删除——validate/execute 签名直接接收 state 参数 |
| `engine-api.ts` | 已合并到 `create-engine.ts`——所有函数从 create-engine 导出 |
| `registerSkillModule` | 已删除——技能模块通过 `skills/index.ts` 的 skillLoaders map 注册 |
| `toPlayerViews` / `AtomPlayerViews` | 已删除——被 `toViewEvents` / `ViewEventSplit` 替代。旧设计返回原始 Atom 的不同版本；新设计返回前端语义化的 ViewEvent，内联 effect |

## 11. 场景推演

### 场景 A：杀 → 流离改目标 → 出闪

```
杀.execute:
  pushFrame('杀', P1, { cardId: 'c1', settlement: [{ target: P2, dodged: false }] })
  移动牌 c1: 手牌(P1) → 处理区

  // 第一阶段:逐个指定所有目标
  applyAtom(state, { type: '指定目标', source: P1, target: P2, cardId: 'c1' })
  ↓ after hooks:
    流离(P2)收到指定目标 → 发动
      await applyAtom(state, 请求回应 confirm) → respond 设 localVars['流离/confirmed']
      await applyAtom(state, 请求回应 chooseTarget) → respond 设 localVars['流离/target']=P3
      弃 P2 手牌一张
      修改 settlement[0].target = P3

  // 第二阶段:逐个结算
  applyAtom(state, { type: '询问闪', target: P3, source: P1 })
  ↓ 等待 P3 回应
  ↓ P3 出闪 → 闪.respond:
    移动牌 闪牌: 手牌(P3) → 处理区
  ↓ applyAtom 返回(挂起结束)
  // 检查处理区:有闪牌 → 移入弃牌堆,标记闪避
  移动牌 闪牌: 处理区 → 弃牌堆

  settlement[0].dodged === true → 不执行造成伤害
  移动牌 c1: 处理区 → 弃牌堆
  popFrame
```

### 场景 B：杀 → 八卦阵判定成功 → 视为闪

```
杀.execute:
  pushFrame → 移动牌 c1 到处理区 → 指定目标 P2

  applyAtom(state, { type: '询问闪', target: P2, source: P1 })
  ↓ before hooks:
    八卦阵(P2).beforeHook('询问闪'):
      target === P2 → applyAtom(判定, judgeType='八卦阵')
      读弃牌堆顶判定牌花色 → 红色
      往处理区插入虚拟闪牌: cardMap['八卦阵:P2:...'] = { name:'闪', ... }
      zones.processing.push(virtualDodgeId)
  ↓ applyAtom 返回(询问闪 pending 挂起,但八卦阵已放闪牌到处理区)
  // 检查处理区:有闪牌(八卦阵的虚拟闪) → 移入弃牌堆,标记闪避
  移动牌 virtualDodgeId: 处理区 → 弃牌堆(虚拟牌从 cardMap 删除)

  settlement[0].dodged === true → 不执行造成伤害
```

### 场景 C：南蛮入侵 → 逐个响应

```
南蛮入侵.execute:
  pushFrame → 移动牌 南蛮牌 到处理区

  for target of [P2, P3, P4]:
    applyAtom(state, { type: '询问杀', target, source: P1 })
    // 检查处理区:有杀牌? → 移到弃牌堆(出了杀);没有 → 收集到 notResponded

  for target of notResponded:
    applyAtom(state, { type: '造成伤害', target, amount: 1, source: P1, cardId })

  移动牌 南蛮牌: 处理区 → 弃牌堆
  popFrame
```

### 场景 D：伤害 → 遗计（郭嘉） → 反馈（司马懿）

```
applyAtom(state, { type: '造成伤害', target: 郭嘉, amount: 1, source: 司马郭 }):
  before hooks: (无)
  apply → state 更新（郭嘉体力 -1）
  after hooks (全部执行):
    遗计(郭嘉).afterHook('造成伤害'):
      target === 郭嘉 → 继续
      摸牌 2 → 请求回应(分配) → respond 设 localVars['遗计/allocation']
      for { target, cardIds } of localVars['遗计/allocation']:
        applyAtom(给予)

    反馈(司马懿).afterHook('造成伤害'):
      target === 司马懿? 不是 → 跳过
```

两个 after hook 都执行。遗计先执行完,反馈再执行。
hook 与 respond action 通过 localVars 通信(非 frame.params)。

### 场景 E：玩家级超时配置

```
// 玩家级配置（可运行时变更）
state.playerConfig[ownerId].timeout = 60000  // 60秒

// 超时优先级链: AtomAwaits.timeout < 实例配置 < 玩家配置 < 默认值
```

---

## 附录：ADR 索引

决策记录（ADR）存放在 `docs/decisions/`。

| 编号 | 标题 | 何时读 |
|---|---|---|
| [0008](./decisions/0008-styling-linaria.md) | Linaria 样式 | UI 改样式时 |
| [0009](./decisions/0009-cas-baseSeq.md) | CAS baseSeq | 序列号 / 并发 / 断线重连 |
| [0010](./decisions/0010-game-logger-playerops.md) | GameLogger + PlayerOps | 视图隔离 / 服务端日志 / ReplayEngine |
| [0012](./decisions/0012-unified-apply-atoms.md) | 统一 applyAtoms | **核心**：所有 atom 必经 `src/engine/atom.ts:applyAtoms` |
| [0013](./decisions/0013-phase-begin-end-atoms.md) | phaseBegin/End 显式成对 | 阶段推进原子化 |
| [0013](./decisions/0013-skill-character-decouple.md) | 技能/角色/装备解耦 | **架构**：engine/{characters,skills,equipment} 分层 |
| [0014](./decisions/0014-reshuffle-atom.md) | reshuffle atom | 修 draw 重洗不写 serverLog |
| [0015](./decisions/0015-give-take-move-3-atoms.md) | giveCard/takeCard 3 原子 | 13+ 技能语义统一 |
| [0016](./decisions/0016-use-card-3-atoms.md) | useCard 3 原子 | specifyTarget / becomeTarget / resolveCard |
| [0017](./decisions/0017-skill-pindian-multistep.md) | pindian / multiStep SkillPhase | 拼点 + 多步 prompt 骨架 |
| [0018](./decisions/0018-deprecated-test-apis.md) | 废弃全局测试 API | 测试从 `clearXxx()` 迁到 `engine.clearForTest()`；多实例隔离 |
| [0026](./decisions/0026-unified-engine-architecture.md) | 统一引擎架构：技能编排 + Atom 执行 + 栈驱动 | **本文档概念起源**：牌=令牌、使用牌=技能、validate 下放、栈驱动执行 |
| [0027](./decisions/0027-create-engine-top-level-functions.md) | create-engine 重构：顶层函数 + state 原地变更 | §4.2 顶层函数式 API 的来历 |
| [0028](./decisions/0028-engine-api-top-level-functions.md) | engine-api 顶层化：无 EngineApi 闭包，无 BackendAPI 回调参数 | 技能直接 import 顶层函数，无闭包对象 |