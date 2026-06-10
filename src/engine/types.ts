// src/engine/types.ts
// 新引擎类型定义。详见 docs/ENGINE-DESIGN.md §3-7

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type Card = {
  id: string;
  name: string;
  suit: '♠' | '♥' | '♣' | '♦';
  rank: number;
  type: '基本牌' | '锦囊牌' | '装备牌';
  subtype?: string;
};

export type CardWrapper = {
  name: string;
  sourceCardId: string;
  fromSkill: string;
};

export type EquipSlot = '武器' | '防具' | '进攻马' | '防御马' | '宝物';

export type TurnPhase = '准备' | '判定' | '摸牌' | '出牌' | '弃牌' | '回合结束';

export type GameStatus = '等待中' | '进行中' | '已结束';

export interface Mark {
  id: string;
  scope: number;
  payload?: Json;
  duration?: 'turn' | 'round' | number;
}


export interface PendingTrick {
  name: string;
  source: string;
  card: Card;
}

export interface PlayerState {
  index: number;
  name: string;
  character: string;
  health: number;
  maxHealth: number;
  alive: boolean;
  hand: string[];
  equipment: Partial<Record<EquipSlot, string>>;
  pendingTricks: PendingTrick[];
  skills: string[];
  vars: Record<string, Json>;
  marks: Mark[];
}

export interface GameState {
  players: PlayerState[];
  currentPlayerIndex: number;
  phase: TurnPhase;
  turn: { round: number; phase: TurnPhase; vars: Record<string, Json> };
  zones: {
    deck: string[];
    discardPile: string[];
    processing: string[];
  };
  settlementStack: SettlementFrame[];
  cardMap: Record<string, Card>;
  rngSeed: number;
  marks: Mark[];
  localVars: Record<string, Json>;
  meta: { gameId: string; createdAt: number };
  seq: number;
  startedAt: number;
  actionLog: ActionLogEntry[];
}

// ==================== ActionPrompt ====================

export type ActionPrompt =
  | UseCardPrompt
  | SelectTargetPrompt
  | UseCardAndTargetPrompt
  | ConfirmPrompt
  | DistributePrompt
  | ChoosePlayerPrompt;

export interface CardFilter {
  filter?: (card: Card) => boolean;
  min: number;
  max: number;
}

export interface TargetFilter {
  min: number;
  max: number;
  filter?: (view: GameView, target: string) => boolean;
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
  cardIds: string[];
  minPerTarget: number;
  maxPerTarget: number;
}
export interface ChoosePlayerPrompt {
  type: 'choosePlayer';
  title: string;
  description?: string;
  min: number;
  max: number;
  filter?: (view: GameView, target: string) => boolean;
}

// ==================== Atom ====================

export interface AtomAwaits {
  target?: string;
  getTarget?: (atom: unknown) => string;
  prompt?: ActionPrompt;
  defaultChoice?: Json;
  timeout?: number;
}

export interface AtomEffect {
  sound?: string;
  animation?: string;
  screenEffect?: string;
  particles?: string;
  duration?: number;
  volume?: number;
  blockUntilDone?: boolean;
}

export type AtomPlayerViews = readonly [
  ownerViews: ReadonlyMap<string, Atom>,
  defaultView: Atom | null,
];

export type ZoneLoc =
  | { zone: '牌堆' }
  | { zone: '弃牌堆' }
  | { zone: '手牌'; player: string }
  | { zone: '处理区' };

export type Atom =
  // 卡牌/资源
  | { type: '摸牌'; player: string; count: number }
  | { type: '弃置'; player: string; cardIds: string[] }
  | { type: '移动牌'; cardId: string; from: ZoneLoc; to: ZoneLoc }
  | { type: '获得'; player: string; cardId: string; from?: string }
  | { type: '给予'; cardId: string; from: string; to: string }
  | { type: '抽牌'; player: string; cardId: string }
  | { type: '装备'; player: string; cardId: string }
  | { type: '卸下'; player: string; slot: EquipSlot }
  | { type: '洗牌' }
  | { type: '重洗' }
  | { type: '整理牌堆'; cards: string[] }
  // 角色状态
  | { type: '造成伤害'; target: string; amount: number; source: string; cardId?: string }
  | { type: '回复体力'; target: string; amount: number; source?: string }
  | { type: '失去体力'; target: string; amount: number }
  | { type: '击杀'; player: string }
  | { type: '设上限'; player: string; amount: number }
  // 标记/状态
  | { type: '加标记'; player: string; mark: Mark }
  | { type: '去标记'; player: string; markId: string }
  | { type: '清过期标记'; player: string }
  | { type: '设横置'; player: string; chained: boolean }
  | { type: '加标签'; player: string; tag: string }
  | { type: '去标签'; player: string; tag: string }
  // 技能管理
  | { type: '添加技能'; player: string; skillId: string }
  | { type: '移除技能'; player: string; skillId: string }
  // 流程
  | { type: '回合开始'; player: string }
  | { type: '回合结束'; player: string }
  | { type: '阶段开始'; player: string; phase: string }
  | { type: '阶段结束'; player: string; phase: string }
  | { type: '设阶段'; phase: TurnPhase }
  | { type: '下一玩家' }
  // 目标
  | { type: '指定目标'; source: string; cardId?: string; target: string }
  // 判定
  | { type: '添加延时锦囊'; player: string; trick: PendingTrick }
  | { type: '移除延时锦囊'; player: string; trickName: string }
  // 拼点
  | { type: '拼点'; initiator: string; target: string; initiatorCard: string; targetCard: string }
  // 等待回应
  | { type: '询问闪'; target: string; source: string }
  | { type: '询问杀'; target: string; source: string }
  | { type: '请求回应'; requestType: string; target: string; prompt: ActionPrompt; defaultChoice?: Json; timeout?: number };

export interface AtomDefinition<A = unknown> {
  type: string;
  validate(state: GameState, atom: A): string | null;
  apply(state: GameState, atom: A): GameState;
  awaits?: AtomAwaits;
  toPlayerViews?(state: GameState, atom: A): AtomPlayerViews | undefined;
  effect?: AtomEffect;
}
export interface GameView {
  viewer: number;
  currentPlayerIndex: number;
  phase: TurnPhase;
  turn: { round: number; phase: TurnPhase; vars: Record<string, Json> };
  players: {
    name: string;
    character: string;
    health: number;
    maxHealth: number;
    alive: boolean;
    equipment: Partial<Record<EquipSlot, string>>;
    skills: string[];
    handCount: number;
    hand?: Card[];
    marks: Mark[];
  }[];
  cardMap: Record<string, Card>;
  pending: PendingView | null;
  /** 出牌/弃牌阶段的操作截止时间(独立于 pending) */
  turnDeadline: number | null;
  log: { time: number; player: string; text: string }[];
}

/** before 钩子上下文:atom 执行前调用 */
export interface AtomBeforeContext {
  state: GameState;
  atom: Atom;
  self: string;
  /** 当前结算帧的参数(可读)。 */
  readonly params: Record<string, Json>;
  modifyParams(patch: Record<string, Json>): void;
  /** 阻止该 atom 执行,before 钩子专用 */
  drop(): void;
  apply(atom: Atom): Promise<void>;
  notify(event: NotifyEvent): void;
}

export interface AtomAfterContext {
  state: GameState;
  atom: Atom;
  self: string;
  /** 当前结算帧的参数(可读)。dispatch 把回应的 params 注入此处。 */
  readonly params: Record<string, Json>;
  modifyParams(patch: Record<string, Json>): void;
  apply(atom: Atom): Promise<void>;
  notify(event: NotifyEvent): void;
}

// ==================== Skill ====================

export interface Skill {
  id: string;
  ownerId: string;
  name: string;
  description: string;
}


export interface PendingView {
  type: 'awaits';
  atom: Atom;
  prompt: ActionPrompt;
  target: string;
  deadline: number;
}

export interface SettlementFrame {
  skillId: string;
  from: string;
  params: Record<string, Json>;
  cards: string[];
  atomStack: Atom[];
  pendingRequest?: { atom: Atom; target: string; status: 'waiting' | 'resolved'; deadline?: number };
  parent?: SettlementFrame;
  /** 在 dispatch 流程中由 settlement 注入(不是 user 写的) */
  apply(atom: Atom): Promise<void>;
  /**
   * applyOrAwait:apply 流程不抛 PendingInterrupt,改用 await promise。
   * 返回 boolean:有 awaits 已收到回应,或无 awaits 已 apply 完成。
   * 用于技能代码在 execute 内同步等待回应(例如杀.execute 末尾在询问闪回应后
   * 继续跑'造成伤害'+'弃牌',让 onAtomAfter('造成伤害') 钩子真正触发)。
   */
  applyOrAwait(atom: Atom): Promise<boolean>;
  /**
   * 取消当前帧的等待回应(把 pendingRequest 标 resolved)。
   * 用于回应 action 在自己的 settlement 帧上执行时(如闪的 execute 把自己
   * 标记为"已响应"),让外层 dispatch 不再等待此回应。
   */
  drop(): void;
  modifyParams(patch: Record<string, Json>): void;
  notify(event: NotifyEvent): void;
  /** 内部:applyOrAwait 等待回应时保存的 resume 闭包,外部 dispatch 调用 */
  _resume?: () => void;
  /** 内部:保存 FrameExecutor 引用,供 respFrame 复用同一个 executor */
  _executor?: { state: GameState };
  /** 内部:applyOrAwait 等待期间,dispatch await 此 Promise 等待 execute 完成 */
  _executePromise?: Promise<void>;
  /** 内部:技能 execute 在 PendingInterrupt 前注册的续跑函数,
   *  dispatch 收到回应后调此函数完成后续 atom(造成伤害/弃牌等)。
   *  使用 frame.apply 让 atom 走完整 pipeline(触发 before/after 钩子)。 */
  _continueFn?: () => Promise<void>;
}
// ==================== 协议 ====================

export interface ClientMessage {
  skillId: string;
  actionType: string;
  ownerId: string;
  params: Record<string, Json>;
  baseSeq: number;
}

export interface NotifyEvent {
  skillId: string;
  eventType: string;
  data: Json;
  views?: ReadonlyMap<string, Json>;
}

export interface ActionLogEntry {
  id: string;
  timestamp: number;
  message: ClientMessage;
  baseSeq: number;
}
// ==================== 内部 Registry 类型 ====================

export interface ActionEntry {
  skillId: string;
  ownerId: string;
  actionType: string;
  validate: (view: GameView, params: Record<string, Json>) => string | null;
  execute: (frame: SettlementFrame) => Promise<void>;
}

export interface AtomHookEntry {
  skillId: string;
  ownerId: string;
  atomType: string;
  phase: 'before' | 'after';
  handler: (ctx: AtomBeforeContext | AtomAfterContext) => Promise<void>;
}

// ==================== SkillDef ====================

export interface BackendAPI {
  /** ownerId(per player instance) */
  readonly self: string;
  registerAction(
    actionType: string,
    validate: (view: GameView, params: Record<string, Json>) => string | null,
    execute: (frame: SettlementFrame) => Promise<void>,
  ): () => void;
  onAtomBefore(
    atomType: string,
    handler: (ctx: AtomBeforeContext) => Promise<void>,
  ): () => void;
  onAtomAfter(
    atomType: string,
    handler: (ctx: AtomAfterContext) => Promise<void>,
  ): () => void;
  apply(atom: Atom): Promise<void>;
  notify(event: NotifyEvent): void;
}

export interface FrontendAPI {
  viewer: string;
  onEvent(handler: (event: GameEvent, view: GameView) => void): () => void;
  defineAction(
    actionType: string,
    opts: {
      label: string;
      style?: 'primary' | 'danger' | 'default' | 'passive';
      prompt: ActionPrompt;
      transform?: (card: Card) => CardWrapper;
    },
  ): void;
  playEffect(effect: AtomEffect): void;
}

export type GameEvent =
  | { kind: 'atom'; atom: Atom; views?: AtomPlayerViews }
  | { kind: 'notify'; skillId: string; eventType: string; data: Json; views?: ReadonlyMap<string, Json> };