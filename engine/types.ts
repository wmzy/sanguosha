import type { TurnPhase, Gender, Faction, Role, Card, PendingTrick } from '../shared/types';

// useCard 拆分（§6 P0）：specifyTarget → becomeTarget → resolveCard
// 旧的 useCard GameEvent 在 [T-13] 决策下被取消。新技能监听 3 原子
// onBefore/onAfter；useCard 路径暂时保留兼容，但 6.0 起不再 emit。
export type { TurnPhase, Gender, Faction, Role, Card, PendingTrick };

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export interface GameState {
  meta: GameMeta;
  phase: TurnPhase;
  currentPlayer: string;
  playerOrder: string[];

  players: Record<string, PlayerState>;
  zones: GameZones;
  cardMap: Record<string, Card>;

  turn: TurnState;
  pending: PendingAction | null;
  triggers: TriggerRule[];

  /** 服务端完整事件日志（用于重播/审计） */
  serverLog: ServerEvent[];
  /** 每个玩家可见的事件 ID 列表 */
  playerLogs: Record<string, string[]>;

  /** 种子化随机数状态（可序列化的数值） */
  rngState: number;

  /** 标记集合：按玩家分组的 Mark 列表（持续但有生命周期的状态） */
  marks: Record<string, Mark[]>;

  /** 延迟濒死检查：技能 pending 解决后自动创建濒死窗口 */
  deferredDyingCheck?: { player: string; source?: string };

  /**
   * 原子级共享上下文变量（§4.6 修复）。
   * 例如 judge atom 在 apply 时把判定牌 cardId 写到这里，
   * getResult 读此字段（避免从 discardPile[top] 误读）。
   * 与 SkillContext.localVars 不同的是：本字段是 GameState 的一部分，
   * 不随技能上下文销毁；按需重置。
   */
  localVars?: Record<string, Json>;
}

export interface GameMeta {
  id: string;
  seed: number;
  round: number;
  turnNumber: number;
  status: GameStatus;
  winner?: string;
  createdAt: number;
  playerCount: number;
  /** 自动跳过无懈可击：当玩家手中无无懈可击时自动不出（调试用） */
  autoSkipWuxie: boolean;
}

export type GameStatus = '等待中' | '进行中' | '已结束';

export type MarkScope = 'player' | 'relation' | 'transient';
export type MarkDuration = 'permanent' | 'untilTurnEnd' | 'untilPhaseEnd';

export interface Mark {
  id: string;
  scope: MarkScope;
  payload?: Record<string, Json>;
  duration: MarkDuration;
}
export interface GameZones {
  deck: string[];
  discardPile: string[];
}
export interface PlayerState {
  info: PlayerInfo;
  health: number;
  maxHealth: number;
  hand: string[];
  equipment: EquipmentSlots;
  pendingTricks: PendingTrick[];
  /** 玩家级状态：技能运行时数据（发动次数、激活标记等） */
  vars: Record<string, Json>;
  /** 标记（增益/减益） */
  tags: string[];
  /** 铁索连环状态：true 时受 fire/thunder 伤害会传导给链上其他角色 */
  chained: boolean;
}

export interface PlayerInfo {
  name: string;
  characterId: string;
  role: Role;
  alive: boolean;
  gender: Gender;
  faction: Faction;
}

export interface EquipmentSlots {
  武器?: string;
  防具?: string;
  防御马?: string;
  进攻马?: string;
}

export type EquipSlot = keyof EquipmentSlots;
export interface TurnState {
  killsPlayed: number;
  skillsUsed: string[];
  turnStarted: boolean; // turnStart atom 是否已派发（防重用）
}
export type PendingAction =
  | PendingPlayPhase
  | PendingResponseWindow
  | PendingSkillPrompt
  | PendingDiscardPhase
  | PendingDyingWindow
  | PendingSelectCard
  | PendingHarvestSelection;

export interface PendingPlayPhase {
  type: '出牌阶段';
  /** 唯一标识，用于客户端 promptId 校验 */
  id: string;
  player: string;
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface PendingResponseWindow {
  type: '响应窗口';
  id: string;
  window: ResponseWindowData;
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface PendingSkillPrompt {
  type: '技能选择';
  id: string;
  skillId: string;
  player: string;
  execution: SkillExecution;
  prompt: PromptDef;
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface PendingDiscardPhase {
  type: '弃牌阶段';
  id: string;
  player: string;
  min: number;
  max: number;
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface PendingDyingWindow {
  type: '濒死窗口';
  id: string;
  dyingPlayer: string;
  currentSaverIndex: number;
  savers: string[];
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
  /** AOE 濒死后恢复上下文：记录剩余目标和需要的牌 */
  resumeAoe?: {
    attacker: string;
    remainingTargets: string[];
    requiredCard: string;
    sourceCard: string;
  };
}

export interface PendingSelectCard {
  type: '选择牌';
  id: string;
  player: string;
  target: string;
  cardIds: string[];
  min: number;
  max: number;
  sourceCard: string;
  mode: '弃置' | '获得';
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface PendingHarvestSelection {
  type: '收获选牌';
  id: string;
  /** 翻出的待选牌 ID 列表 */
  revealedCards: string[];
  /** 当前选牌者在 pickOrder 中的索引 */
  currentPickerIndex: number;
  /** 选牌顺序列表（逆时针，从当前回合玩家开始） */
  pickOrder: string[];
  /** 出牌者（五谷丰登使用者） */
  player: string;
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface SkillExecution {
  phaseIndex: number;
  ctx: SkillContext;
  plan: SkillPhase[];
}
/** damage 原子和事件的 type 字段值（见 docs/ENGINE.md §5 T-11） */
export type DamageType = 'normal' | 'fire' | 'thunder';
/**
 * Atom 是唯一修改 GameState 的通道。
 * 每个 Atom 类型通过 registerAtom() 注册，包含 apply 和 toEvents。
 */
export type Atom =
  | { type: '造成伤害'; target: Expr<string>; amount: Expr<number>; source?: Expr<string>; cardId?: Expr<string>; damageType?: Expr<DamageType> }
  | { type: '回复体力'; target: Expr<string>; amount: Expr<number>; source?: Expr<string> }
  | { type: '失去体力'; target: Expr<string>; amount: Expr<number> }
  | { type: '摸牌'; player: Expr<string>; count: Expr<number> }
  | { type: '弃置'; player: Expr<string>; cardIds: Expr<string[]> }
  | { type: '随机弃置'; player: Expr<string>; count: Expr<number>; from: '手牌' | '装备' }
  | { type: '移动牌'; cardId: Expr<string>; from: ZoneLoc; to: ZoneLoc }
  | { type: '失去牌'; cardId: Expr<string>; from: { zone: '手牌' | '装备'; player: Expr<string>; slot?: EquipSlot } }
  | { type: '给予'; cardId: Expr<string>; from: Expr<string>; to: Expr<string> }
  | { type: '抽牌'; cardId: Expr<string>; to: Expr<string> }
  | { type: '装备'; player: Expr<string>; cardId: Expr<string> }
  | { type: '卸下'; player: Expr<string>; slot: EquipSlot }
  | { type: '设置变量'; player: Expr<string>; key: string; value: Expr<Json> }
  | { type: '增加变量'; player: Expr<string>; key: string; delta: Expr<number> }
  | { type: '清空变量'; player: Expr<string>; pattern: string }
  | { type: '推入待定'; action: PendingAction }
  | { type: '弹出待定' }
  | { type: '设阶段'; phase: TurnPhase }
  | { type: '下一玩家' }
  | { type: '判定'; player: Expr<string>; varKey?: string }
  | { type: '添加延时锦囊'; player: Expr<string>; trick: PendingTrick }
  | { type: '移除延时锦囊'; player: Expr<string>; index: number }
  | { type: '加标签'; player: Expr<string>; tag: string }
  | { type: '去标签'; player: Expr<string>; tag: string }
  | { type: '重洗' }
  | { type: '洗牌' }
  | { type: '击杀'; player: Expr<string>; source?: Expr<string> }
  | { type: '获得'; player: Expr<string>; cardId: Expr<string>; from: ZoneLoc }
  | { type: '设置上下文变量'; key: string; value: Json }
  | { type: '累计出杀' }
  | { type: '整理牌堆'; player: Expr<string>; topCardIds: Expr<string[]>; bottomCardIds: Expr<string[]> }
  | { type: '设上限'; player: Expr<string>; delta: Expr<number> }
  | { type: '加技能'; player: Expr<string>; skillId: string; source?: { characterMap: Record<string, import('../shared/types').CharacterConfig> } }
  | { type: '去技能'; player: Expr<string>; skillId: string }
  | { type: '回合开始'; player: Expr<string> }
  | { type: '阶段开始'; phase: Expr<string>; player: Expr<string> }
  | { type: '阶段结束'; phase: Expr<string>; player: Expr<string> }
  | { type: '指定目标'; cardId: Expr<string>; source: Expr<string>; target: Expr<string> }
  | { type: '成为目标'; cardId: Expr<string>; source: Expr<string>; target: Expr<string> }
  | { type: '解决'; cardId: Expr<string>; source: Expr<string>; target?: Expr<string> }
  | { type: '设横置'; target: Expr<string>; chained: Expr<boolean> }
  | { type: '拼点'; a: Expr<string>; b: Expr<string>; aCardId: Expr<string>; bCardId: Expr<string> }
  | { type: '加标记'; player: Expr<string>; mark: Mark }
  | { type: '去标记'; player: Expr<string>; markId: string }
  | { type: '清过期标记'; phase: TurnPhase };
/**
 * 事件元组：[服务端事件, 特殊视角 Map, 默认玩家事件]
 * - [0] 服务端完整事件 → 写入 serverLog
 * - [1] 特殊视角 Map → Map 中的玩家看到特定内容
 * - [2] 默认事件 → 不在 Map 中的玩家看到此事件（null = 不可见）
 */
export type AtomEventResult = readonly [
  ServerEvent,
  ReadonlyMap<string, PlayerEvent>,
  PlayerEvent | null,
];

export interface AtomDefinition<A = unknown> {
  type: string;
  apply(state: GameState, atom: A): GameState;
  toEvents(state: GameState, atom: A): AtomEventResult;
  /** 可选：atom apply 后从 state 提取结果，自动注入到 ctx.localVars */
  getResult?(state: GameState, atom: A): Record<string, Json>;
}
/**
 * 动态值引用。字面量直接使用，对象形式通过 resolve() 求值。
 */
export type Expr<T> =
  | T
  | ExprCtx
  | ExprEvent
  | ExprVar
  | ExprCount
  | ExprDistance
  | ExprCardProp
  | ExprCond<T>
  | ExprAdd
  | ExprSub
  | ExprHandSize
  | ExprAliveCount;

export interface ExprCtx {
  $: 'ctx';
  path: string;
}

export interface ExprEvent {
  $: 'event';
  path: string;
}

export interface ExprVar {
  $: 'var';
  player: Expr<string>;
  key: string;
}

export interface ExprCount {
  $: 'count';
  source: Expr<string>;
}

export interface ExprDistance {
  $: 'distance';
  from: Expr<string>;
  to: Expr<string>;
}

export interface ExprCardProp {
  $: 'cardProp';
  card: Expr<string>;
  prop: 'suit' | 'color' | 'type' | 'name' | 'rankValue';
}

export interface ExprCond<T> {
  $: 'cond';
  check: Condition;
  then: Expr<T>;
  else: Expr<T>;
}

export interface ExprAdd {
  $: 'add';
  left: Expr<number>;
  right: Expr<number>;
}

export interface ExprSub {
  $: 'sub';
  left: Expr<number>;
  right: Expr<number>;
}

export interface ExprHandSize {
  $: 'handSize';
  player: Expr<string>;
}

export interface ExprAliveCount {
  $: 'aliveCount';
}

/** 判断是否是 Expr 对象（需要 resolve） */
export function isExpr(value: unknown): value is (ExprCtx | ExprEvent | ExprVar | ExprCount | ExprDistance | ExprCardProp | ExprCond<unknown> | ExprAdd | ExprSub | ExprHandSize | ExprAliveCount) {
  return typeof value === 'object' && value !== null && '$' in value;
}
export type Condition =
  | { equals: [unknown, unknown] }
  | { notEquals: [unknown, unknown] }
  | { gte: [Expr<number>, Expr<number>] }
  | { lte: [Expr<number>, Expr<number>] }
  | { gt: [Expr<number>, Expr<number>] }
  | { lt: [Expr<number>, Expr<number>] }
  | { hasVar: { player: Expr<string>; key: string } }
  | { hasTag: { player: Expr<string>; tag: string } }
  | { isAlive: Expr<string> }
  | { handEmpty: Expr<string> }
  | { hasValue: Expr<unknown> }
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition };
/**
 * 技能执行计划中的一步。通过 registerPhase() 注册处理逻辑。
 */
export type SkillPhase =
  | { type: 'atoms'; ops: Atom[] }
  | { type: 'condition'; check: Condition; then: SkillPhase[]; else?: SkillPhase[] }
  | { type: 'prompt'; text: string; options: PromptOption[]; defaultChoice?: Json; timeout?: number }
  | { type: '打出'; window: ResponseWindowDef }
  | { type: 'loop'; body: SkillPhase[]; while: Condition }
  | { type: 'emit'; event: GameEvent }
  | { type: 'foreach'; collection: Expr<string[]>; body: SkillPhase[]; varName: string }
  | { type: 'checkDying'; player: Expr<string> }
  | { type: 'pindian'; a: Expr<string>; b: Expr<string>; aCardId?: Expr<string>; bCardId?: Expr<string>; then: SkillPhase[]; else?: SkillPhase[] }
  | { type: 'multiStep'; steps: SkillPhase[] };
export interface PhaseDefinition<P = unknown> {
  type: string;
  execute(
    state: GameState,
    phase: P,
    ctx: SkillContext,
    plan: SkillPhase[],
    index: number,
  ): EngineResult;
}
export interface SkillContext {
  skillId: string;
  self: string;
  target?: string;
  choice?: Json;
  source?: string;
  sourceCard?: string;
  event?: GameEvent;
  localVars: Record<string, Json>;
}
export interface SkillDef {
  id: string;
  name: string;
  description: string;
  /**
   * v2 trigger 规格。当 skill 完全由 v3 `registerAtomHook` 驱动时可省略
   * （v3 钩子不依赖此字段）。[T-25] 迁移完成后，所有 skill 可省略此字段。
   */
  trigger?: TriggerSpec;
  /**
   * TypeScript 函数，返回 SkillPhase[] 执行计划。
   * 函数本身不需要序列化，只有执行计划中的 prompt/respond 需要暂停。
   * v3-only skill（无 trigger）可保留此函数供 v2 fallback / 调试；典型实现返回 []。
   */
  handler: (ctx: SkillContext, state: GameState) => SkillPhase[];
  /**
   * 被动卡牌转换声明：`from` 源卡名 → `to` 目标卡名（如 '杀' → '闪'）。
   * validate.getSkillConvertedCards 读此字段替代硬编码。
   * 数组形式以支持双向转换（龙胆：杀↔闪）。
   * filter 为可选条件；不填则无条件转换。
   */
  convertible?: SkillConvertible[];
}
/**
 * 技能卡牌转换条目。
 * - `from: '*'` 表示任意卡名（用于"任意黑色手牌当闪"等规则）。
 * - `filter` 为可选 Condition；不填则无条件转换。
 * - 表达式内可通过 `{ $: 'ctx', path: 'localVars.cardId' }` 引用当前校验卡 ID。
 *   validate 层构造一个临时 SkillContext 把 `cardId` 注入 `localVars`。
 *
 * 例：武圣红色杀当杀
 * ```
 * filter: { or: [
 *   { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♥'] },
 *   { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♦'] },
 * ] }
 * ```
 *
 * 例：倾国任意黑色手牌当闪
 * ```
 * { from: '*', to: '闪', filter: { or: [
 *   { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♠'] },
 *   { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♣'] },
 * ] } }
 * ```
 */
export interface SkillConvertible {
  /** 源卡名；'*' 表示任意卡。 */
  from: string;
  to: '杀' | '闪' | '桃';
  /** 可选条件；不填则无条件转换。 */
  filter?: Condition;
}
export interface TriggerSpec {
  event: string;
  filter?: Condition;
  source: '角色' | '装备';
  priority?: number;
  optional?: boolean;
  phase?: TurnPhase;
  manual?: boolean;
}
export interface TriggerRule {
  event: string;
  filter?: Condition;
  source: '角色' | '装备';
  skillId: string;
  player: string;
  priority: number;
  optional?: boolean;
}
export type GameAction =
  | { type: '打出一张牌'; player: string; cardId: string; target?: string }
  | { type: '打出'; player: string; cardId?: string; cardIds?: string[] }
  | { type: '结束回合'; player: string }
  | { type: '弃置'; player: string; cardIds: string[] }
  | { type: '使用技能'; player: string; skillId: string; target?: string }
  | { type: '技能选择'; player: string; choice: Json }
  | { type: '开始' }
  | { type: '切换自动跳过无懈可击' };
export type GameEvent =
  | { type: '回合开始'; player: string }
  | { type: '回合结束'; player: string }
  | { type: '阶段开始'; phase: TurnPhase; player: string }
  | { type: '阶段结束'; phase: TurnPhase; player: string }
  /** @deprecated v3+ 将由 useCard 3 原子 (指定目标/成为目标/解决, [T-13]) 取代；v2 路径保留至 [T-22] 迁移完成。仅 出牌 弃用，非全部 GameEvent。 */
  | { type: '出牌'; player: string; cardId: string; target?: string }
  | { type: '造成伤害'; source: string; target: string; amount: number; cardId?: string }
  | { type: '受到伤害'; target: string; source: string; amount: number; cardId?: string }
  | { type: '回复体力'; target: string; amount: number; source?: string }
  | { type: '杀被闪避'; attacker: string; defender: string }
  | { type: '杀命中'; attacker: string; defender: string }
  | { type: '摸牌'; player: string; count: number }
  | { type: '弃置'; player: string; cardIds: string[] }
  | { type: '装备变动'; player: string; slot: EquipSlot; oldCardId?: string; newCardId?: string }
  | { type: '判定结果'; player: string; cardId: string; result: '红' | '黑' }
  | { type: '濒死'; player: string; source?: string }
  | { type: '死亡'; player: string; source?: string }
  | { type: '技能发动'; player: string; skillId: string };
export interface ServerEvent {
  id: string;
  type: string;
  timestamp: number;
  payload: Json;
}

export type PlayerEvent = ServerEvent; // 结构相同，但 payload 内容可能被裁剪
export interface PromptDef {
  text: string;
  options: PromptOption[];
  defaultChoice?: Json;
  timeout?: number;
}

export type PromptOption =
  | { label: string; value: Json }
  | { type: 'selectPlayer'; filter?: Condition }
  | { type: '选择牌'; from: string; min?: number; max?: number }
  | { type: 'selectCards'; from: string; min: number; max: number }
  | { type: 'orderCards'; cardIds: string[]; topLabel: string; bottomLabel: string };

export interface ResponseWindowDef {
  type: 'killResponse' | 'aoeResponse' | 'dyingResponse' | 'trickResponse' | 'duelResponse';
  attacker?: string;
  defender: string;
  validCards: string[];
  sourceCard?: string;
  /** aoeResponse 链：剩余需要响应的玩家（不含当前 defender） */
  remainingTargets?: string[];
  /** aoeResponse 链：需要的牌（杀/闪） */
  requiredCard?: string;
  /** trickResponse 链：原锦囊目标（区别于 defender 当前响应者） */
  trickTarget?: string;
  /** trickResponse 链：原锦囊使用者（嵌套时保持不变；attacker 字段在嵌套时是上一张无懈者） */
  sourceUser?: string;
  /** @deprecated 旧顺序链式字段，保留兼容 */
  remainingPlayers?: string[];
  /** @deprecated 旧顺序链式字段，保留兼容 */
  negated?: boolean;
  /** 判定阶段无懈上下文：当前 trickResponse 是为判定阶段的延时锦囊开的窗口 */
  judgmentContext?: {
    player: string;
    trickIndex: number;
  };
  /** 抢占式无懈可击：所有可响应的玩家（按行动顺序） */
  responders?: string[];
  /** 抢占式无懈可击：已 pass 的玩家 */
  passedResponders?: string[];
  /** 无双（吕布）：杀需要几张闪才能抵消 */
  requiredFlashCount?: number;
  /** 无双（吕布）：决斗中每次需要出几张杀 */
  requiredKillCount?: number;
  /** 嵌套深度：0=原锦囊被无懈, 1=无懈被无懈, ... */
  depth?: number;
  /** 无懈可击链：按出牌顺序记录已打出的无懈（不含当前正在询问的那张） */
  wuxieChain?: { attacker: string; cardId: string }[];
  /** AOE 无懈上下文：无懈通过后需要恢复 AOE 流程 */
  aoeResume?: {
    attacker: string;
    remainingTargets: string[];
    requiredCard: string;
    sourceCard: string;
  };
}

export interface ResponseWindowData extends ResponseWindowDef {
  timeout: number;
  deadline: number;
}
export type ZoneLoc =
  | { zone: '牌堆' }
  | { zone: '弃牌堆' }
  | { zone: '手牌'; player: Expr<string> }
  | { zone: '装备'; player: Expr<string>; slot: EquipSlot };
export interface EngineResult {
  state: GameState;
  events: ServerEvent[];
  playerEvents?: Map<string, PlayerEvent[]>;
  error?: string;
}

export type ValidAction =
  | { type: '打出一张牌'; prompt: string; cards: PlayableCard[] }
  | { type: '打出'; prompt: string; required: boolean; cards: string[]; canPass: boolean }
  | { type: '使用技能'; prompt: string; skills: AvailableSkill[] }
  | { type: '弃置'; prompt: string; min: number; max: number; cards: string[] }
  | { type: '技能选择'; prompt: string; options: PromptOption[] }
  | { type: '结束回合'; prompt: string };

export interface PlayableCard {
  cardId: string;
  targets: string[];
  convertedFrom?: string;
  convertedTo?: string;
}

export interface AvailableSkill {
  skillId: string;
  name: string;
  description: string;
  targets?: string[];
  canActivate: boolean;
  reason?: string;
}

export interface TimeoutConfig {
  killResponse: number;
  aoeResponse: number;
  trickResponse: number;
  dyingResponse: number;
  skillPrompt: number;
  playPhase: number;
  selectCard: number;
  discardPhase: number;
  harvestSelection: number;
}

export const TIMEOUT_DEFAULTS: TimeoutConfig = {
  killResponse: 15000,
  aoeResponse: 10000,
  trickResponse: 10000,
  dyingResponse: 20000,
  skillPrompt: 15000,
  playPhase: 60000,
  selectCard: 30000,
  discardPhase: 30000,
  harvestSelection: 30000,
};
