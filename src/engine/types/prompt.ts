// ActionPrompt 类型:前端交互契约(出牌/选目标/分配/选将/选牌/选花色等 prompt)。
// 原 src/engine/types.ts 的 `==================== ActionPrompt ====================` 段。

import type { Card, Faction } from './state';
import type { GameView } from './view';

/** action 激活上下文:传给 activeWhen 谓词,供 action 声明"我什么时候该被激活"。
 *  这是 view 的一个子集——只包含决定激活与否的字段,避免谓词读到过多状态。
 *  语义:前端在渲染前为每个 action 计算 isActive = activeWhen?.(ctx) ?? false,
 *  只有 active 的 action 才渲染为可交互控件(出牌按钮/技能按钮高亮)。
 *  缺省 activeWhen = "出牌阶段且为当前视角回合且无 pending"(最常见的主动出牌场景)。 */
export interface ActionContext {
  /** 当前 view(完整,供谓词按需读取 phase/players/pending 等) */
  view: GameView;
  /** 当前视角座次(看谁;正式模式 = viewer) */
  perspectiveIdx: number;
}

/** action 激活谓词。返回 true = 该 action 在当前上下文下应被激活(渲染为可交互)。 */
export type ActionActiveWhen = (ctx: ActionContext) => boolean;

export type ActionPrompt =
  | UseCardPrompt
  | SelectTargetPrompt
  | UseCardAndTargetPrompt
  | ConfirmPrompt
  | DistributePrompt
  | ChoosePlayerPrompt
  | ChooseCharacterPrompt
  | PickProcessingCardPrompt
  | PickTargetCardPrompt
  | ChooseSuitPrompt
  | ChooseOptionPrompt;

export interface CardFilter {
  filter?: (card: Card) => boolean;
  min: number;
  max: number;
}

export interface TargetFilter {
  min: number;
  max: number;
  filter?: (view: GameView, target: number) => boolean;
  /** 多槽位目标(语义不同的多个目标,如借刀杀人 A 持武器 + B 在 A 攻击范围)。
   *  有 slots 时 min/max 忽略,前端按槽位顺序渲染,每个槽位独立选择。
   *  ctx.selected 包含已选座次(前序槽位),供后续槽位依赖前序选择。
   *  filter 仅为前端 UI 提示(高亮/禁用),不参与后端 validate。 */
  slots?: Array<{
    label: string;
    filter?: (view: GameView, target: number, ctx: { selected: number[] }) => boolean;
  }>;
}

export interface UseCardPrompt {
  type: 'useCard';
  title: string;
  description?: string;
  cardFilter: CardFilter;
}
export interface SelectTargetPrompt {
  type: 'selectTarget';
  title: string;
  description?: string;
  targetFilter: TargetFilter;
}
export interface UseCardAndTargetPrompt {
  type: 'useCardAndTarget';
  title: string;
  description?: string;
  cardFilter: CardFilter;
  targetFilter: TargetFilter;
  /** 自动以自己为目标(桃/酒):前端无需手动选目标,直接提交 target=self。 */
  selfTarget?: boolean;
}
export interface ConfirmPrompt {
  type: 'confirm';
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}
export interface DistributePrompt {
  type: 'distribute';
  title: string;
  description?: string;
  /** 分配模式:
   *  - 'allocate'(默认,遗计/仁德):把手牌逐张分配给若干目标,提交 `allocation=[{target,cardIds}]`。
   *  - 'select'(制衡):只选若干张牌,提交 `cardIds=[...]`。
   * 被动 pending(遗计)走 allocate;主动技(仁德/制衡)由 onMount 指定。 */
  mode?: 'allocate' | 'select';
  /** 静态牌列表(遗计 pending 用:引擎摸出的指定两张)。
   *  与 source 二选一:有 cardIds = 静态;有 source = 动态;都没有 = 默认当前视角手牌。 */
  cardIds?: string[];
  /** 动态选牌来源(主动技用,随手牌/装备变化):
   *  - 'hand' 或缺省:当前视角手牌。
   *  - 'handAndEquip':手牌 + 装备区(制衡用)。 */
  source?: 'hand' | 'handAndEquip';
  /** allocate 模式:每个目标最少/最多收几张。默认 1..99。 */
  minPerTarget?: number;
  maxPerTarget?: number;
  /** 总选牌数限制(两种模式通用)。默认 1..99。select 模式主要约束。 */
  minTotal?: number;
  maxTotal?: number;
  /** allocate 模式:是否允许分配给自己(仁德不允许,遗计允许)。默认 true。 */
  allowSelf?: boolean;
  /** allocate 模式:目标合法性过滤(存活/非自己等由前端组合判断)。 */
  targetFilter?: (view: GameView, target: number) => boolean;
}
export interface ChoosePlayerPrompt {
  type: 'choosePlayer';
  title: string;
  description?: string;
  min: number;
  max: number;
  filter?: (view: GameView, target: number) => boolean;
}

/** 选将(从候选人中选一个武将) */
export interface ChooseCharacterPrompt {
  type: 'chooseCharacter';
  title: string;
  description?: string;
  /** 可选武将列表 */
  candidates: Array<{ name: string; skills: string[] }>;
}

/** 选牌面板(五谷丰登:从处理区亮出的 N 张明牌中选一张到手牌)。
 *  使用者可看见全部候选牌,直接点具体 cardId。
 *
 *  respond params: { cardId }
 *  超时默认:选候选列表第一张牌(不放弃选牌机会)。 */
export interface PickProcessingCardPrompt {
  type: 'pickProcessingCard';
  title: string;
  description?: string;
  /** 处理区明牌候选(使用者可见) */
  cards: Array<{ cardId: string; cardName: string; suit: Card['suit']; rank: string }>;
}

/** 选花色(反间:目标从 ♠♥♣♦ 中猜一种花色)。
 *  respond params: { suit: '♠' | '♥' | '♣' | '♦' }。
 *  超时默认:选 ♠(不放弃猜测机会,描述未指定超时行为)。 */
export interface ChooseSuitPrompt {
  type: 'chooseSuit';
  title: string;
  description?: string;
}

/** 选项选择(化身:从多个结构化选项中选一个)。
 *  respond params: { option: value }
 *  超时默认:由各技能的兜底逻辑处理(如 askSelectSkill 的 usable[0])。
 *
 *  武将牌面板:characterCards 附带每张武将牌的可视化数据(势力色+技能列表),
 *  key = option.value(武将名),供前端渲染武将牌选择面板。无 characterCards 时
 *  前端只渲染普通选项按钮列表。 */
export interface ChooseOptionPrompt {
  type: 'chooseOption';
  title: string;
  description?: string;
  options: Array<{ value: string; label: string; description?: string }>;
  /** 武将牌可视化数据。key = option.value(武将名) */
  characterCards?: Record<string, { faction: Faction; skills: string[] }>;
}

/** 选牌面板(过河拆桥/顺手牵羊生效后,使用者从目标区域选一张牌)。
 *  流程:选牌 → 选目标(任一区域有牌即合法) → 出牌(不指定具体卡) → 询问无懈 →
 *        本 pending 弹出 → 使用者按区域选具体牌 → respond。
 *
 *  - 装备区/判定区是明牌:使用者可见,直接选具体 cardId。
 *  - 手牌是暗牌:使用者只能凭牌背位置盲选第 K 张 —— 这正是博弈核心:
 *    目标可偷偷调整手牌顺序,使用者根据历史推测规律,目标可反向博弈。
 *
 *  respond params:
 *    { zone: 'equipment', cardId } / { zone: 'judge', cardId } / { zone: 'hand', handIndex }
 *  超时默认:若目标有明牌选第一张明牌,否则盲选 hand[0]。 */
export interface PickTargetCardPrompt {
  type: 'pickTargetCard';
  title: string;
  description?: string;
  /** 被选牌的玩家座次 */
  target: number;
  /** 装备区明牌候选(使用者可见) */
  equipment: Array<{ slot: string; cardId: string; cardName: string }>;
  /** 判定区明牌候选(使用者可见) */
  judge: Array<{ cardId: string; cardName: string }>;
  /** 手牌张数(盲选用,前端渲染 N 个牌背) */
  handCount: number;
}
