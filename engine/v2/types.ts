import type { TurnPhase, Gender, Faction, Role, Card, PendingTrick } from '../../shared/types';

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
}

export type GameStatus = '等待中' | '进行中' | '已结束';

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
  weapon?: string;
  armor?: string;
  horsePlus?: string;
  horseMinus?: string;
}

export type EquipSlot = keyof EquipmentSlots;
export interface TurnState {
  killsPlayed: number;
  skillsUsed: string[];
  phaseFlags: string[]; // 'skipDraw', 'skipPlay', etc.
}
export type PendingAction =
  | PendingResponseWindow
  | PendingSkillPrompt
  | PendingDiscardPhase
  | PendingDyingWindow
  | PendingSelectCard;

export interface PendingResponseWindow {
  type: 'responseWindow';
  window: ResponseWindowData;
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface PendingSkillPrompt {
  type: 'skillPrompt';
  skillId: string;
  player: string;
  execution: SkillExecution;
  prompt: PromptDef;
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface PendingDiscardPhase {
  type: 'discardPhase';
  player: string;
  min: number;
  max: number;
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface PendingDyingWindow {
  type: 'dyingWindow';
  dyingPlayer: string;
  currentSaverIndex: number;
  savers: string[];
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface PendingSelectCard {
  type: 'selectCard';
  player: string;
  target: string;
  cardIds: string[];
  min: number;
  max: number;
  sourceCard: string;
  timeout: number;
  deadline: number;
  onTimeout: GameAction;
}

export interface SkillExecution {
  phaseIndex: number;
  ctx: SkillContext;
  plan: SkillPhase[];
}
/**
 * Atom 是唯一修改 GameState 的通道。
 * 每个 Atom 类型通过 registerAtom() 注册，包含 apply 和 toEvents。
 */
export type Atom =
  | { type: 'damage'; target: Expr<string>; amount: Expr<number>; source?: Expr<string>; cardId?: Expr<string> }
  | { type: 'heal'; target: Expr<string>; amount: Expr<number>; source?: Expr<string> }
  | { type: 'draw'; player: Expr<string>; count: Expr<number> }
  | { type: 'discard'; player: Expr<string>; cardIds: Expr<string[]> }
  | { type: 'discardRandom'; player: Expr<string>; count: Expr<number>; from: 'hand' | 'equipment' }
  | { type: 'moveCard'; cardId: Expr<string>; from: ZoneLoc; to: ZoneLoc }
  | { type: 'equip'; player: Expr<string>; cardId: Expr<string> }
  | { type: 'unequip'; player: Expr<string>; slot: EquipSlot }
  | { type: 'setVar'; player: Expr<string>; key: string; value: Expr<Json> }
  | { type: 'incrementVar'; player: Expr<string>; key: string; delta: Expr<number> }
  | { type: 'clearVarPattern'; player: Expr<string>; pattern: string }
  | { type: 'pushPending'; action: PendingAction }
  | { type: 'popPending' }
  | { type: 'setPhase'; phase: TurnPhase }
  | { type: 'nextPlayer' }
  | { type: 'judge'; player: Expr<string>; varKey?: string }
  | { type: 'addPendingTrick'; player: Expr<string>; trick: PendingTrick }
  | { type: 'removePendingTrick'; player: Expr<string>; index: number }
  | { type: 'addTag'; player: Expr<string>; tag: string }
  | { type: 'removeTag'; player: Expr<string>; tag: string }
  | { type: 'kill'; player: Expr<string>; source?: Expr<string> }
  | { type: 'gainCard'; player: Expr<string>; cardId: Expr<string>; from: ZoneLoc }
  | { type: 'setCtxVar'; key: string; value: Json };
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
}
/**
 * 动态值引用。字面量直接使用，对象形式通过 resolve() 求值。
 */
export type Expr<T> =
  | T
  | ExprCtx
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
  prop: 'suit' | 'color' | 'type' | 'name';
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
export function isExpr(value: unknown): boolean {
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
  | { type: 'respond'; window: ResponseWindowDef }
  | { type: 'loop'; body: SkillPhase[]; while: Condition }
  | { type: 'emit'; event: GameEvent }
  | { type: 'foreach'; collection: Expr<string[]>; body: SkillPhase[]; varName: string }
  | { type: 'checkDying'; player: Expr<string> };
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
  trigger: TriggerSpec;
  /**
   * TypeScript 函数，返回 SkillPhase[] 执行计划。
   * 函数本身不需要序列化，只有执行计划中的 prompt/respond 需要暂停。
   */
  handler: (ctx: SkillContext, state: GameState) => SkillPhase[];
}

export interface TriggerSpec {
  event: string;
  filter?: Condition;
  source: 'character' | 'equipment';
  priority?: number;
  optional?: boolean;
  phase?: TurnPhase;
  manual?: boolean;
}

export interface TriggerRule {
  event: string;
  filter?: Condition;
  source: 'character' | 'equipment';
  skillId: string;
  player: string;
  priority: number;
}
export type GameAction =
  | { type: 'playCard'; player: string; cardId: string; target?: string }
  | { type: 'respond'; player: string; cardId?: string; cardIds?: string[] }
  | { type: 'endTurn'; player: string }
  | { type: 'discard'; player: string; cardIds: string[] }
  | { type: 'useSkill'; player: string; skillId: string; target?: string }
  | { type: 'skillChoice'; player: string; choice: Json };
export type GameEvent =
  | { type: 'turnStart'; player: string }
  | { type: 'turnEnd'; player: string }
  | { type: 'phaseBegin'; phase: TurnPhase; player: string }
  | { type: 'phaseEnd'; phase: TurnPhase; player: string }
  | { type: 'cardPlayed'; player: string; cardId: string; target?: string }
  | { type: 'damageDealt'; source: string; target: string; amount: number; cardId?: string }
  | { type: 'damageReceived'; target: string; source: string; amount: number; cardId?: string }
  | { type: 'heal'; target: string; amount: number; source?: string }
  | { type: 'killDodged'; attacker: string; defender: string }
  | { type: 'killHit'; attacker: string; defender: string }
  | { type: 'cardDrawn'; player: string; count: number }
  | { type: 'cardDiscarded'; player: string; cardIds: string[] }
  | { type: 'equipChanged'; player: string; slot: EquipSlot; oldCardId?: string; newCardId?: string }
  | { type: 'judgeResult'; player: string; cardId: string; result: 'red' | 'black' }
  | { type: 'dying'; player: string; source?: string }
  | { type: 'death'; player: string; source?: string }
  | { type: 'skillActivated'; player: string; skillId: string };
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
  | { type: 'selectCard'; from: string; min?: number; max?: number }
  | { type: 'selectCards'; from: string; min: number; max: number };

export interface ResponseWindowDef {
  type: 'killResponse' | 'aoeResponse' | 'dyingResponse' | 'trickResponse' | 'duelResponse';
  attacker?: string;
  defender: string;
  validCards: string[];
  sourceCard?: string;
}

export interface ResponseWindowData extends ResponseWindowDef {
  timeout: number;
  deadline: number;
}
export type ZoneLoc =
  | { zone: 'deck' }
  | { zone: 'discardPile' }
  | { zone: 'hand'; player: string }
  | { zone: 'equipment'; player: string; slot: EquipSlot };
export interface EngineResult {
  state: GameState;
  events: ServerEvent[];
  error?: string;
}
export interface GameView {
  state: ClientGameState;
  pending?: PendingView;
  actions: ValidAction[];
}

export interface ClientGameState {
  self: string;
  players: Record<string, ClientPlayer>;
  phase: TurnPhase;
  currentPlayer: string;
  turn: { killsPlayed: number };
  zones: { discardPile: Card[]; deckCount: number };
}

export interface ClientPlayer {
  name: string;
  health: number;
  maxHealth: number;
  hand: Card[];
  handCount: number;
  equipment: Record<string, Card | undefined>;
  characterId: string;
  role: Role;
  alive: boolean;
  gender: Gender;
  faction: Faction;
  vars: Record<string, Json>;
}

export type ValidAction =
  | { type: 'playCard'; prompt: string; cards: PlayableCard[] }
  | { type: 'respond'; prompt: string; required: boolean; cards: string[]; canPass: boolean }
  | { type: 'useSkill'; prompt: string; skills: AvailableSkill[] }
  | { type: 'discard'; prompt: string; min: number; max: number; cards: string[] }
  | { type: 'skillChoice'; prompt: string; options: PromptOption[] }
  | { type: 'endTurn'; prompt: string };

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

export interface PendingView {
  type: string;
  prompt: string;
  options?: PromptOption[];
  validCards?: string[];
  timeout: number;
  deadline: number;
}
export interface TimeoutConfig {
  killResponse: number;
  aoeResponse: number;
  dyingResponse: number;
  skillPrompt: number;
  playPhase: number;
  selectCard: number;
  discardPhase: number;
}

export const TIMEOUT_DEFAULTS: TimeoutConfig = {
  killResponse: 15000,
  aoeResponse: 10000,
  dyingResponse: 20000,
  skillPrompt: 15000,
  playPhase: 60000,
  selectCard: 30000,
  discardPhase: 30000,
};
