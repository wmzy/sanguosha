# v3 引擎重构设计

> 状态：草案
> 配套：[0000-gap-archive.md](./0000-gap-archive.md) 缺口归档
> 待办：[0002-todo-decisions.md](./0002-todo-decisions.md) 待决策项
> 修订：2026-06-04

---

## 0. 设计目标

1. **可重放**：GameState 序列化 → 反序列化 → 重放产生完全一致的最终状态。
2. **操作可组合**：原子、事务、复合三类操作有清晰边界，能从 35+ 原子扩到 60+ 而不破坏可读性。
3. **可读性优先**：技能 handler 一眼看懂"做了什么"，不依赖 validate 偷塞、不依赖 handler return [] 当条件分支。
4. **可测试**：技能测试不绕过引擎（不再 `emitEvent` 直接驱动）。
5. **写一次就够**：卡牌效果只有一处真源（CardDef → effect tree），不再 card-handlers / response-handlers / shared 三处重复。

---

## 1. 核心设计原则

## 1.1 三层原子性模型

把 v2 含糊的"原子操作"拆成**三个正交维度**：

| 维度 | 含义 | 引擎保证 |
|---|---|---|
| **状态原子** | 一次 apply 完成的"事情颗粒度" | field / card / bundle / transaction |
| **事件原子** | emit 多少 ServerEvent | 0 / 1 / 多个（但内部有序）|
| **时序原子** | 能否在中间被打断 | 不可中断 / 可中断于某点 |

**操作原子 = 状态原子 ∧ 事件原子 ∧ 时序原子**。

> 例：`damage` 状态原子 = "field（health-1）" + 事件原子 = "1 个 damage event" + 时序原子 = "不可中断"。
> 例：`pindian` 状态原子 = "card bundle" + 事件原子 = "1 个 pindian event" + 时序原子 = "等待 2 个玩家输入"（可中断于 prompt）。

## 1.2 操作的"四象限"分类

|  | 同步 | 异步（需输入）|
|---|---|---|
| **单点** | 字段原子（setVar / setHealth / addMark）| 单点提示（selectCard / selectPlayer）|
| **多点** | 事务原子（swapHands / transferDamage / multiTarget）| 多点提示（pindian / five-grains / 蛊惑链）|

**关键区分**：

- 同步操作 = engine 内部 apply，emit 0/1/多个事件
- 异步操作 = 推进到 `pending`，等玩家响应，**期间 state 完全冻结**（不允许其他异步操作同时进行；可被同步操作如 damage 中断？不，**freeze 整个推进直到 pending resolve**）
- 多点操作 = 涉及 ≥2 玩家或 ≥2 牌区，**在事务边界内不允许 emit 中间状态事件**

## 1.3 "事务"的硬约束

凡是涉及多玩家 / 多牌区 / 多阶段的操作，必须满足：

1. **前置快照** — 事务开始时把相关字段快照到 `ctx.transactionSnapshot`
2. **应用期** — 中间 apply 不 emit 任何外部可见事件（仅内部 log）
3. **提交** — 事务结束时 emit **一个** `TransactionEvent` 包含所有 delta
4. **失败回滚** — 任意子操作失败，事务整体回滚到 snapshot
5. **可重放** — 反序列化后 `TransactionEvent` + 初始 snapshot 可重放

**应用事务的操作**：
- swapHands（鲁肃缔盟）
- transferDamage（小乔天香：原目标不减血，新目标 +1）
- multiTarget（方天画戟多目标杀）
- giveCard（仁德给牌：多张手牌给一个目标）
- gainCardFromEach（张辽突袭：从每个目标拿一张）
- 借刀杀人（被借方用杀）
- 五谷丰登（牌堆 N → 每人 1）
- 替主公出杀（刘备激将）

**应用"伪事务"的操作**（实际是多次单点，但逻辑不可分）：
- 反间（"展示一张牌" + "目标选花色" + "判定" 是逻辑不可分，但中间状态需 emit 用于 UI）

## 1.4 "时序原子"的可中断点

只有"决策点"才是可中断的——需要"读取当前 state 决定下一步"的时刻。三种决策点：

1. **外部决策**（等玩家）：pindian / selectCard / selectPlayer
2. **内部决策**（"做完了吗？"）：loop 终止条件
3. **拦截决策**（"这个事件是否继续？"）：鬼道改判、空城拒目标

**拦截决策的引擎支持**：每个原子操作可声明 `interceptPoints: InterceptPoint[]`：

```ts
type InterceptPoint = 
  | { kind: 'beforeCardEffect'; cardId: string }
  | { kind: 'beforeDamageApply'; target: string; amount: number }
  | { kind: 'beforeJudgeResolve'; judgeResult: CardId }
  | { kind: 'afterCardUsed'; cardId: string };
```

拦截器（`registerSkill` 注册 `kind: 'interceptor'`）可"替换"或"取消"事件流。

## 1.5 "不可见"与"有限可见"事件

v2 的 ownerMap 单 key 模型不支撑"多玩家可见"场景（观星暗看诸葛亮、火攻展示给目标、反间展示给目标）。v3 引入**多接收者视图**：

```ts
type ViewSpec = {
  all: PlayerEvent | null;     // 公开版
  some: Record<PlayerId, PlayerEvent>;  // 部分玩家专属
};
```

每条 ServerEvent 自带 `views: ViewSpec[]`，**没有 views 的玩家看不到此事件**。

---

## 2. 操作分类与统一抽象

> 这一节是 v3 的核心：**把所有"做一件事"的操作归类到统一抽象**。

## 2.1 Mark 体系（铁索/翻面/创牌/不屈的统一）

**核心洞察**：铁索、翻面、创牌（不屈）、化身牌、左慈新生的"临时技能牌" 都是 "PlayerState 上挂载的一段附加状态"。**统一为 `Mark<T>` 系统**。

```ts
// 三类 Mark 作用域
type MarkScope = 'player'           // 个体型（翻面、创牌、护甲 buff）
              | 'relation'         // 关系型（铁索：双向连）
              | 'transient';       // 临时型（左慈化身牌、技能挂件）

// 标记定义
interface MarkDef<T = unknown> {
  id: MarkId;                  // 全局唯一
  scope: MarkScope;
  // 对 'player'：一个 key
  // 对 'relation'：两个 playerId + direction
  // 对 'transient'：一个 ownerPlayerId + payload T
  payload?: T;
  // 生命周期
  duration: 
    | { kind: 'permanent' }
    | { kind: 'until'; event: GameEventType; /* e.g. 'turnEnd' */ }
    | { kind: 'untilPhase'; phase: TurnPhase }
    | { kind: 'untilDead' }
    | { kind: 'manual' };  // 必须显式 remove
  // 读点（可选）：引擎在某些操作前自动查这个
  // 例如 chained 的"damage 流过时被传导"
  hooks?: {
    onDamagePassing?: 'transmit' | 'absorb' | null;
  };
}
```

**统一的状态变化**：
- `addMark` / `removeMark` 原子（不区分 player/relation/transient，由 scope 决定存哪）
- `PlayerState.marks: MarkId[]`（player/transient 挂这里）
- `GameState.relations: Record<MarkId, [A, B]>`（relation 挂这里）

**统一规则**：
- 翻面 = `addMark(player, 'faceDown', { scope: 'player', duration: { kind: 'manual' } })`
- 铁索连环 = `addMark([P1, P2], 'chained', { scope: 'relation', hooks: { onDamagePassing: 'transmit' } })`
- 周泰创牌 = `addMark(player, 'toughCard', { scope: 'player', payload: cardId, duration: { kind: 'untilDead' } })`
- 左慈化身牌 = `addMark(player, 'huashenCard', { scope: 'transient', payload: { characterId, skills: [...] }, duration: { kind: 'until' } })`

**统一读取**：
- `state.players[P].marks` 查个体标记
- `state.relations` 查关系（"P1 和 P2 之间有没有 chained？"）
- `queryMark(state, markId)` 通用查

**传导规则的归属**：
- Mark 的 `hooks.onDamagePassing` 是声明
- damage atom 在 apply 前查 `state.relations['chained']` 找所有涉及 `target` 的关系
- 若有 'transmit' hook，对其他端点再 apply 一次 damage（同样的 source、type）
- **damager 不需要知道 chained 是什么，Mark 系统统一处理**

**优势**：
- 未来加 "诅咒" 标记（玩家死后对杀者造成伤害）只需加一个 `onKill: 'curse'` hook
- 未来加 "护甲"（SP 武将的 buff 护甲）只需 addMark + 减伤时 query
- 未来加 "延时锦囊" 也可以统一为 transient Mark + 判定触发

## 2.2 Transaction 体系（缔盟/天香/借刀/激将的统一）

```ts
interface TransactionDef {
  id: TransactionId;
  // 参与方
  participants: Expr<PlayerId[]>;
  // 涉及区域
  zones: ZoneRef[];  
  // 步骤（可嵌套）
  steps: TransactionStep[];
  // 失败时回滚策略
  rollbackStrategy: 'full' | 'partial';
}

type TransactionStep = 
  | { kind: 'snapshot'; targets: Expr<...>[] }      // 快照
  | { kind: 'move'; cardId: Expr<CardId>; from: ZoneRef; to: ZoneRef }
  | { kind: 'addMark'; target: Expr<...>; mark: MarkDef }
  | { kind: 'damage'; target: Expr<PlayerId>; amount: Expr<number> }
  | { kind: 'prompt'; prompt: PromptDef }           // 事务内允许的决策点
  | { kind: 'ifExpr'; cond: Expr<boolean>; then: TransactionStep[]; else?: TransactionStep[] }
  | { kind: 'commit' }                              // 提交并 emit TransactionEvent
  | { kind: 'abort' };                              // 回滚
```

**关键决策**：
- 事务**不**有自己的 `apply` 路径——事务是 `SkillPhase` 树的一种，apply 时**展开为对 `engine.applyState` 的多个原子调用**，但**前置 createSnapshot + 后置 emit TransactionEvent**
- 中间 prompt 的 `pending` 字段标记 `parentTransaction: TransactionId`，resolve 后继续事务
- **若事务超时或玩家退出**，自动回滚

**应用**：
- 鲁肃缔盟：snapshot(双方手牌) → 弃差值 → move(对方手牌) ↔ move(自己手牌) → commit
- 小乔天香：snapshot(目标伤害流) → addMark(self, 'loseHealth'?) → damage(新目标, 1) → 取消旧 damage（abort 原 damage transaction）
- 借刀杀人：snapshot → prompt 选被借刀 → 强制其 prompt(对 B 出杀) → 若不出杀则 move(武器, target, self)
- 刘备激将：prompt(蜀势力其他角色) → 选 → 强制其 useKill(target) → 若不出杀则 noop

## 2.3 Pindian 体系（驱虎/天义/制霸/烈刃/双雄的统一）

```ts
interface PindianDef {
  // 双方（默认 initiator + 1 目标）
  playerA: Expr<PlayerId>;
  playerB: Expr<PlayerId>;
  // 选牌策略
  cardSelection: 
    | { kind: 'hand'; count: 1 }            // 默认
    | { kind: 'anyVisible'; count: 1 };
  // 比较规则（默认点数）
  compareRule: 
    | { kind: 'rank' }                       // 默认
    | { kind: 'suitOrder' };
  // 赢/输/平的 plan
  onWin: SkillPhase | SkillPhase[];
  onLose: SkillPhase | SkillPhase[];
  onTie: SkillPhase | SkillPhase[];
  // 拼点牌的去向
  cardDest: 
    | { kind: 'discardPile' }
    | { kind: 'winner'; zone: 'hand' | 'discardPile' }  // 烈刃赢者拿输者手牌
    | { kind: 'custom'; handler: Expr<...> };
}
```

**双玩家同步亮牌**的引擎实现：
- 双方各自 pending（隐藏），都响应后**同步揭示**（在 engine tick 一次 emit）
- 揭示时**仅发起者知道对方是谁**（隐私），其他人公开

## 2.4 Judgment 体系（观星/鬼道/闪电/兵粮/乐不思蜀的统一）

**v3 目标**：判定牌"在 reveal 前是隐藏"是普遍规则。`judge` 不再"apply 后取弃牌堆顶"，而是：

```ts
interface JudgeStep {
  player: Expr<PlayerId>;
  // 判定牌的来源
  source: { kind: 'topOfDeck' } | { kind: 'var'; varKey: string };
  // 在 reveal 之前可选操作（观星重排、鬼道替换）
  beforeReveal: SkillPhase[];
  // reveal 时哪个玩家可见
  visibility: 
    | { kind: 'public' }
    | { kind: 'self' }                        // 诸葛亮观星
    | { kind: 'selfAndOwner'; owner: Expr<PlayerId> };  // 反间展示给目标
  // 比较规则
  check: {
    rule: 'isRed' | 'isBlack' | 'isHeart' | 'isSpade' | 
          'isNotHeart' | 'isNotDiamond' | 'isSpecific' | 
          { kind: 'suitOrder'; highSuit: Suit };
  };
  // 检查失败/成功的效果
  onPass: SkillPhase | SkillPhase[];
  onFail: SkillPhase | SkillPhase[];
  // 判定牌最终去向
  dest: { kind: 'discardPile' } | { kind: 'ownerHand' };
}
```

**观星**：用 `beforeReveal: [lookAtTopCards + reorder]` + `visibility: 'self'`。
**鬼道**：用 `beforeReveal: [skillPrompt(replace)]` + 替换后再 check。
**闪电**：默认的 judge，dest 是 `ownerHand`（闪电生效前在自己判定区）。

## 2.5 CardDef / Effect 单一真源

v2 三处真源问题（CardDef / card-handlers / response-handlers）v3 改：

```ts
interface CardDef {
  id: string;
  name: string;
  type: 'basic' | 'trick' | 'equipment';
  subtype?: string;        // 'kill' | 'dodge' | 'peach' | ...
  trickType?: 'normal' | 'aoe' | 'delayed';
  // 卡牌效果：所有效果都在这里
  effect: CardEffect;
}

type CardEffect = 
  | { kind: 'single'; /* 单目标锦囊 */; target: TargetSpec; effect: SkillPhase[] }
  | { kind: 'aoe'; /* 全体锦囊 */; effectPerTarget: (target: Expr<PlayerId>) => SkillPhase[] }
  | { kind: 'self'; /* 自用 */; effect: SkillPhase[] }
  | { kind: 'delayed'; /* 延时锦囊 */; judge: JudgeStep; onTrigger: SkillPhase[]; onExpire: SkillPhase[] }
  | { kind: 'equipment'; onEquip: SkillPhase[]; onUnequip: SkillPhase[]; passiveEffect: PassiveEffect };
```

`engine/handlers/card-handlers.ts` 和 `response/*.ts` **完全消失**——所有卡牌逻辑走 `executeCard(state, card, action)` 走 CardDef.effect 树。

## 2.6 Damage / Heal / Buff 的伤害类型化

```ts
type DamageType = 'normal' | 'fire' | 'thunder' | 'none';

interface DamageDef {
  target: Expr<PlayerId>;
  amount: Expr<number>;
  source: Expr<PlayerId | null>;
  type: DamageType;
  // 可被何种 Mark 防止
  preventableBy: MarkId[];  // ['tengJia', 'daWu', ...]
  // 可被何种 Mark 吸收
  absorbableBy: MarkId[];
  // 可被何种 Mark 反射
  reflectableBy: MarkId[];
}
```

**钩子链**：
```
damage(source, target, amount, type)
  ↓
1. 查 target.marks 中是否有 preventDamageBy(type)
   是 → damage 被防止，emit 'damagePrevented'，不进入 apply
2. 查 target 是否被 source 的某 Mark 锁（如 unaffected）
   是 → damage 被吸收，emit 'damageAbsorbed'
3. apply damage: target.health -= amount
4. 查 relations: 若 target 与他人有 chained 且 type 在传导类型内
   是 → 对该他人递归 damage（同样的 source）
5. 触发 onDamageReceived 事件链
6. 触发 dying 检查
```

## 2.7 Express 表达式扩展

v2 缺的关键 expr：

```ts
type Expr<T> = ...
  | { kind: 'roleOf'; player: Expr<PlayerId> }
  | { kind: 'factionOf'; player: Expr<PlayerId> }
  | { kind: 'genderOf'; player: Expr<PlayerId> }
  | { kind: 'isLord'; player: Expr<PlayerId> }
  | { kind: 'isSameFaction'; a: Expr<PlayerId>; b: Expr<PlayerId> }
  | { kind: 'handCards'; player: Expr<PlayerId> }     // string[]
  | { kind: 'lastHandCard'; player: Expr<PlayerId> }  // string | null
  | { kind: 'topOfDeck'; count: Expr<number> }        // string[] (Judge hook only)
  | { kind: 'cardSuit'; cardId: Expr<CardId> }
  | { kind: 'cardRank'; cardId: Expr<CardId> }
  | { kind: 'cardName'; cardId: Expr<CardId> }
  | { kind: 'cardIsRed'; cardId: Expr<CardId> }
  | { kind: 'cardOfZone'; zone: ZoneRef; filter?: Expr<boolean> }
  | { kind: 'livingPlayers' }                          // string[]
  | { kind: 'playersInFaction'; faction: Faction }
  | { kind: 'hasMark'; player: Expr<PlayerId>; mark: MarkId }
  | { kind: 'markPayload'; player: Expr<PlayerId>; mark: MarkId }
  | { kind: 'marksRelatingTo'; player: Expr<PlayerId> } // relation marks
```

## 2.8 State 增补字段

```ts
interface GameState {
  // ... v2 字段保留
  players: Record<PlayerId, PlayerState>;
  relations: RelationStore;   // NEW
  marks: MarkStore;           // NEW
  // RNG 必须可重放
  rng: RngState;              // 替换 v2 的 rngState: number
  // 时间用相对 ms，不用 Date.now()
  turnClock: number;          // 相对 game start 的 ms
  // 事务栈（事务内嵌套时用）
  transactions: TransactionId[];
}

interface PlayerState {
  // ... v2 字段保留
  marks: MarkInstance[];      // NEW（替换 v2 的 vars 部分）
  faceUp: boolean;            // NEW
  chained: boolean;           // NEW（冗余存，便于查，但 source-of-truth 是 relations）
  judgmentZone: PendingTrick[]; // 改名（v2 是 pendingTricks）
  // vars 改为强类型
  vars: {
    turnScoped: MarkMap;      // 回合结束清
    phaseScoped: MarkMap;     // 阶段结束清
    permanent: MarkMap;       // 不清
  };
}
```

## 2.9 主公技 / 身份 / 势力

v3 引入 `queryPlayer` 表达式 + `RoleRegistry`：

```ts
// 主公判定用 expr
{ kind: 'isLord'; player: ... }
{ kind: 'sameFaction'; a: ...; b: ... }
{ kind: 'roleOf'; player: ... }

// 技能注册时
registerSkill({
  id: 'tianYi',
  trigger: ...,
  // NEW: 注册时声明需要的主公/势力条件
  requires: { role: 'lord' } | { faction: '吴' } | ...,
  handler: ...,
})
```

**`registerCharacterTriggers` 只在 `requires` 满足时注册**——主公技不再无脑注册给所有人。

## 2.10 触发器 / 事件系统

```ts
type GameEvent = 
  // ... v2 16 个保留
  | { type: 'cardEffect'; cardId: string; target: string; effect: 'pending' | 'applied' | 'cancelled' }
  | { type: 'judgeResolve'; player: string; judgeCardId: string; result: JudgeResult }
  | { type: 'healthChange'; player: string; from: number; to: number; reason: 'damage' | 'heal' | 'loseHealth' | 'loseMax' }
  | { type: 'markChange'; mark: MarkId; op: 'add' | 'remove'; target: PlayerId | [PlayerId, PlayerId] }
  | { type: 'handChange'; player: string; from: number; to: number }
  | { type: 'cardRevealed'; cardId: string; visibility: 'public' | 'self' | 'selfAndOwner' };
```

**关键修复**：
- `TriggerRule.phase` 在所有事件类型都生效（不再只 phaseBegin）
- `priority` 有 5 个标准值 + 文档约束
- `filter: Condition` 接收 `ctx` 上下文

---

## 3. Skill Handler 的统一范式

v3 的 skill handler 必须遵守：

```ts
interface SkillHandlerResult {
  // 显式声明做什么，不靠 return [] 当条件分支
  plan: SkillPhase[];                    // 必填，不允许空数组作为"无操作"
  // 可选：发动条件（fail 则不 emit、不付 event cost）
  condition?: Expr<boolean>;
  // 可选：声明这是限定技/觉醒技
  meta?: {
    type: 'awakening' | 'limited' | 'oncePerTurn' | 'passive';
    oncePerPhase?: 'turn' | 'round' | 'game';
  };
}
```

`return []` **不再合法**——必须显式 `plan: []` 或根本不调用注册（用 `condition: Expr<false>`）。

---

## 4. 撤销 SkillDef 与 CharacterConfig 双源

v3 删 `shared/characters/*.ts` 的 `abilities.effect/condition/modifiers/passive` 字段。`CharacterConfig` 只剩：

```ts
interface CharacterConfig {
  id: string;
  name: string;
  maxHealth: number;
  gender: '男' | '女';
  faction: Faction;
  // 仅作 UI/文档用
  abilities: { id: string; name: string; description: string }[];
  // 真实注册在 engine/skills/*.ts
}
```

UI 通过 `getSkillDef(id)` 查详情，不需要 `character.abilities[i].effect` 这层。

---

## 5. 不再允许的"反模式"清单

v3 中明确禁止：

1. ❌ `handler() { return []; }`（占位）— 用 `condition: Expr<false>`
2. ❌ `validate.ts` 里写 `if (char === '关羽') { /* 武圣逻辑 */ }` — 用 `SkillDef.convertible`
3. ❌ `card-handlers.ts` 里手写新卡牌流程 — 用 `CardDef.effect` 树
4. ❌ `engine/atoms/X.ts` 里 `getResult` 读 `discardPile[top]` — 用 `varKey` 显式追踪判定牌
5. ❌ `setVar('据守/flipped')` 用 vars 表示状态 — 用 `marks`
6. ❌ 在 `engine/skill.ts` 里手动 `if (event.phase === '出牌')` — 用 `TriggerRule.phase`
7. ❌ `var('X/usedThisTurn')` 命名不统一 — 用 `vars.turnScoped` + 强类型 key
8. ❌ 跨玩家操作"裸"调用 `applyAtom` — 用 Transaction
9. ❌ 临时事件携带 `cardId` 字段靠 `ctx.sourceCard` 传递 — 用 `SkillContext` 显式参数
10. ❌ 判定/取牌走弃牌堆顶 — 用 `JudgeStep` / `cardOfZone` 显式源

---

## 6. 重写顺序（按依赖关系）

P0（解锁 18 技能，1 周）：
1. 扩展 Expr 系统（§2.7）
2. 重做 Mark 体系（§2.1）— 翻面/铁索/创牌统一
3. 重做 Judge（§2.4）— 修复 v2 判定 bug
4. 加 Pindian SkillPhase（§2.3）
5. 加 Transaction（§2.2）— 缔盟/天香/激将
6. 重做 Damage 类型化（§2.6）
7. 重做 CardDef 单一真源（§2.5）— 锦囊重写
8. 重做 Skill Handler 范式（§3）

P1（解锁 5 技能，3 天）：
9. 加 multiTarget / multiRespond SkillPhase
10. 加 Intercept 机制（鬼道/空城/帷幕）
11. 加 removeSkill / addBuff atom
12. 主公/势力 query
13. 基础时序原子（freeze / pending 关联）

P2（解锁 5 技能，1 周）：
14. 借刀 / 化身 / 创牌
15. 序列化重做
16. 视图系统（多玩家可见）

---

## 7. 与 v2 兼容性

v3 实施分两步：
- **过渡期**：v3 与 v2 共存。新代码走 v3 路径，旧 stub 保持。
- **切换期**：v2 路径全删。

skill 文件改造顺序：
- 先新建 `engine/v3/`，新技能先在 v3 注册
- `engine/skills/wei.ts` 等逐步把 `registerSkill` 迁到 v3
- 最终 `engine/skills/` 目录只放 v3 文件
