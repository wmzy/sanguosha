# GameView 完整重构设计

**日期**: 2026-06-20
**目标**: 将 `src/client/components/GameView.tsx`(1063 行)重构为职责清晰的组件/hooks/函数,并把出牌规则回归到技能 prompt 驱动,消除三处重复真相。

## 现状问题

### 1. 死代码 hook
`src/client/hooks/useCardActions.ts` 抽取了出牌/回应/转化逻辑,但 GameView 从未 import——内部仍硬编码一份重复的同名函数。

### 2. 架构层:出牌绕过技能注册表
`handlePlayCard`(基本牌/锦囊)按 `card.name` 硬编码分支(`TARGET_REQUIRED_CARDS.has`、`TWO_TARGET_CARDS.has`、`isDelayedTrick`),而 `handleSkillAction`(武将技/装备技)读 prompt 驱动。**同一套"这张牌需要几个目标/什么参数"的规则存了三份**:
- `src/engine/card-meta.ts` 的 5 个 Set
- 各技能 `onMount → defineAction('use')` 的 prompt
- GameView 的 if 分支

漂移证据:借刀杀人 `onMount` 声明 `targetFilter: { min:1, max:1 }`,但前端靠 `TWO_TARGET_CARDS.has('借刀杀人')` 渲染成双目标——**契约与实现脱节**。

### 3. 内联 IIFE 渲染块
目标选择(90 行)、pending 回应区(60 行)、distribute 弹窗(30 行)、中央信息区、手牌单卡、座位弧形布局——全部内联在 JSX 里。

### 4. 回归漂移:装备牌点不出(2026-06-20 发现)
重构后 GameView 查找 use action 时退回了 `card.name→skillId` 反查(`playCardSkillId`),但装备的 use action 以 skillId `装备通用` 注册、cardFilter 声明 `type==='装备牌'`,反查路径用具体装备名(`诸葛连弩`)查不到 → 装备牌选不中、出不了。根因正是「适用范围」存在两处真相(声明的 cardFilter + 反查的 name 映射)。本次修复彻底转向 filter-based 查找 + activeWhen 声明时机,消除析接表达(见 A3、B2)。

## 设计

### A. 架构层:prompt 驱动出牌

#### A1. targetFilter 扩展 slots(解决多目标语义)

`src/engine/types.ts`:
```ts
export interface TargetFilter {
  min: number;
  max: number;
  filter?: (view: GameView, target: number) => boolean;
  /** 多槽位目标(语义不同的多个目标)。
   *  有 slots 时 min/max 忽略,前端按槽位顺序渲染,每个槽位独立选择。
   *  ctx.selected 包含已选座次(前序槽位),供 B 槽位依赖 A 槽位。 */
  slots?: Array<{
    label: string;
    filter?: (view: GameView, target: number, ctx: { selected: number[] }) => boolean;
  }>;
}
```

`借刀杀人.ts` onMount:
```ts
targetFilter: {
  min: 2, max: 2,  // 兜底(无 slots 时语义)
  slots: [
    { label: '持武器者', filter: (view, t) => hasWeapon(view.players[t]) },
    { label: '被杀者', filter: (view, t, ctx) => canAttack(view.players, view.cardMap, ctx.selected[0], t) },
  ],
},
```

#### A2. SELF_TARGET_CARDS 退役
在 `UseCardAndTargetPrompt` 加 `selfTarget?: boolean`。桃/酒声明 `selfTarget: true`,前端无需手动选目标。

#### A3. 出牌与用技合流(filter-based 查找)
删除 `handlePlayCard` 的 `card.name` 分支,改为**遍历当前玩家的 use action 跑 `cardFilter` 匹配选中卡**(`findUseActionForCard`)。use action 的适用范围由技能 `defineAction('use')` 时声明的 `prompt.cardFilter` 表达——装备通用声明 `filter=c=>c.type==='装备牌'`,杀声明 `filter=c=>c.name==='杀'`,前端跑 filter 命中即匹配。

> **反模式警告**:不要回到"用 card.name→skillId 反查"的写法(已删除的 `playCardSkillId` 就是此类析接函数)。那种写法要求「牌名」与「skillId」两处真相保持同步,一旦漂移就出现装备点不出的 bug。**适用范围只有一个真相:声明里的 cardFilter。**

> 注:'装备通用' 作为承载 use action 的 skillId 仍保留(它是「所有装备共用一套使用逻辑」的合理容器),但前端不再以 skillId 反查,而是靠 cardFilter 匹配。

### B. card-meta Set 退役
前端不再 import 5 个 Set:
- `RANGE_REQUIRED_CARDS`:由 `targetFilter.filter`(顺手牵羊声明距离过滤)表达
- `TARGET_REQUIRED_CARDS`:由 prompt 类型为 `useCardAndTarget` 表达
- `TWO_TARGET_CARDS`:由 `targetFilter.slots` 表达
- `SELF_TARGET_CARDS`:由 `selfTarget` 字段表达
- `RESPOND_ONLY_CARDS`:由"该牌是否有 use action"判断(只有 respond action = 只能回应)

`card-meta.ts` 仅保留 `isEquipment` / `isDelayedTrick` / `getWeaponRange` 等纯查询,`getEquipmentSkillNames` 等派生函数。

### B2. 声明驱动:激活时机(activeWhen)

**原则:action 声明即真相——不仅声明「适用哪些牌」(cardFilter)、「需什么目标」(targetFilter),还要声明「何时该被激活」。前端不再硬编码 `isMyTurn && view.phase === '出牌'` 这类分支,而是调用 action 声明的 `activeWhen` 谓词决定是否渲染为可交互控件。**

`types.ts`:
```ts
export interface ActionContext {
  view: GameView;
  perspectiveIdx: number;
}
export type ActionActiveWhen = (ctx: ActionContext) => boolean;

// defineAction opts 新增:
activeWhen?: ActionActiveWhen;
```

`gameViewHelpers.ts` 提供缺省实现与判定函数:
```ts
// 缺省激活条件(绝大多数主动出牌/用技场景):出牌阶段 + 当前视角回合 + 无 pending
const DEFAULT_PLAY_ACTIVE = (ctx) =>
  ctx.view.currentPlayerIndex === ctx.perspectiveIdx
  && ctx.view.phase === '出牌'
  && ctx.view.pending === null;

export function isActiveAction(action, ctx): boolean {
  return action.activeWhen ? action.activeWhen(ctx) : DEFAULT_PLAY_ACTIVE(ctx);
}
```

消费点(全部用 `isActiveAction` 替代硬编码分支):
- `PlayerCardLarge`:技能按钮/装备技能按钮显隐(取代 `showSkillButtons = isMyTurn && canOperate && phase==='出牌'`)
- `GameView`:出牌按钮、目标选择器显隐(取代 actionBar 里的 `isMyTurn && view.phase==='出牌'`)

绝大多数 use action 不需显式声明 `activeWhen`(继承缺省)。需要特殊时机的技能(如濒死时才能发动的桃)在 `defineAction` 里声明 `activeWhen` 覆盖缺省。

> **反模式警告**:不要在组件里重新写 `view.phase === '出牌' && isMyTurn` 这类分支来判断某个 action 是否该显示。这会让「何时激活」出现两处真相(组件硬编码 + action 声明),一旦漂移就出现「该亮的按钮不亮 / 不该亮的亮了」。若需调整某 action 的激活时机,**改它的 `activeWhen` 声明,而非改组件**。

> 分层说明:`isMyTurn` 作为「当前是否处于出牌交互模式」的全局状态标志仍保留(手牌可点性 `canPlay` 等),这不属于 action 级声明;action 级的显隐一律走 `activeWhen`。

### C. 组件/hooks/函数拆分

**子组件**(8 个,纯展示):
| 组件 | 来源 | 职责 |
|---|---|---|
| `GameHeader` | GameView 550–575 | 轮次/阶段/视角切换/退出 |
| `OverlaysLayer` | 520–548 | 身份揭示 + 选将遮罩组合 |
| `AwaitingPrompt` | 600–660 | pending 回应区(distribute/confirm/useCard 三分支) |
| `PlayPhasePrompt` | 662–700 | 出牌/distribute 主动技/弃牌提示 |
| `TargetSelector` | 930–1010 | 单/多槽位通用目标选择 |
| `SeatArcLayout` | 747–790 | 弧形座位布局 |
| `ZoneInfoBar` | 792–822 | 牌堆/处理区/弃牌堆中央信息 |
| `HandCard` | 1035–1060 | 单张手牌(扇形/选中/转化/动画) |

**hooks**(5 个):
| hook | 职责 |
|---|---|
| `useSkillActions` | skillActions 注册表注册 effect |
| `usePendingState` | `isPerspectiveAwaiting`/`isDiscardPhase`/`discardMin/Max`/`skippedBroadcast` 派生 |
| `useCharSelect` | 选将状态(own/parallel/inProgress) |
| `useSeatOrder` | `orderedPlayers` memo |
| `useCardActions` | **已存在,接上**,补 transformMode/distributeMode |

**纯函数**(4 个):
| 函数 | 职责 |
|---|---|
| `buildPlayParams` | `handlePlayCard` 的 params 构造 |
| `buildSkillParams` | `handleSkillAction` 的 switch |
| `arcLayout` | 弧形坐标计算 |
| `resolveDistributeCardIds` | distribute 的 cardIds 解析 |

## 迁移顺序

1. **安全抽取**(行为不变):接上 `useCardActions`,抽 8 组件 + 4 hooks + 4 纯函数。GameView → ~250 行。
2. **targetFilter.slots**:types.ts 扩展 + 借刀杀人声明 slots + `TargetSelector` 改通用渲染。
3. **出牌 prompt 驱动**:`buildPlayParams` 读 prompt,删除 card.name 分支;补全各技能 `targetFilter.filter`/`selfTarget`。
4. **card-meta Set 退役**:删除前端对 5 个 Set 的 import,移除 card-meta 中对应定义。

每步后验证:出杀、出借刀杀人(A+B)、武圣转化、回应闪、出桃自疗。

## 非目标
- 不改 engine 执行流(仍走 dispatch)。
- 不改技能 `onInit`/`registerAction`(后端 validate 不动,仅扩展 onMount 的 prompt 声明)。
- 不动 `DebugLobby` / `useDebugPerspective` / `useDebugLobbyController`(它们只消费 GameView props)。

## 风险
- **技能 prompt 完整性**:步骤 3 依赖所有出牌技能声明完整 targetFilter。若遗漏,出牌 UI 会退化为"不需目标"。通过步骤 3 前的扫描 + 回归验证控制。
- **transformMode 状态合并**:现 useCardActions hook 的 transformMode 签名与 GameView 内联版略有差异,合并需对齐。
