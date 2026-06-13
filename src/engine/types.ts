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
  rank: string;
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
  /** 标签集合——轻量无 payload 标记(如 '八卦阵/autoDodge'),通过 加标签/去标签 atom 维护。
   *  可选:未设置时引擎视同空数组(由 createGameState 兜底) */
  tags?: string[];
  /** 判定区:当前正在被判定中的牌 ID 列表(顶端最新) */
  judgeZone: string[];
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
  /** 当前正在 apply 栈上的 atom 列表(栈顶=最新)。游戏状态属性,不是 frame 属性 */
  atomStack: Atom[];
  /** 当前等待中的 pending slot(同时只有一个等待) */
  pendingSlot?: PendingSlot;
  cardMap: Record<string, Card>;
  cardWrappers: Record<string, CardWrapper>;
  rngSeed: number;
  marks: Mark[];
  localVars: Record<string, Json>;
  meta: { gameId: string; createdAt: number };
  seq: number;
  startedAt: number;
  actionLog: ActionLogEntry[];
  /**
   * 内部 drop 标志(由 engine-api 内部使用):applyAtom 进入时重置为 false,
   * 仅供 6 个防具/武器 skill 调整伤害用,新代码不应使用。
   */
  _dropNext?: boolean;
  /** 内部:当前活跃的 execute Promise,回应路径上用于等待原始 execute 完成。 */
  _activeExecuteP?: Promise<void>;
  /**
   * 当前 dispatch/fireTimeout 在等的"稳定点" Promise。
   * 每个 execute lifecycle 创建一个新 Promise,execute 完成或新 pending 创建时 resolve。
   * 等价于"下一个 pending 出现 OR 当前 execute 真的结束"二者择一。
   */
  _waitForStable?: Promise<void>;
  /** 配套的 resolve 函数,供通知触发点使用 */
  _resolveStable?: () => void;
}

/** 创建 GameState 的统一工厂。缺失字段自动补默认值 */
export function createGameState(partial: Partial<GameState> & { players: PlayerState[]; cardMap: Record<string, Card> }): GameState {
  // 兜底:为缺失 tags 字段的 players 补默认值
  const players = partial.players.map((p): PlayerState => {
    if (p.tags) return p;
    const { tags: _ignored, ...rest } = p as PlayerState & { tags?: string[] };
    void _ignored;
    return { ...rest, tags: [] };
  });
  return {
    currentPlayerIndex: 0,
    phase: '准备',
    turn: { round: 1, phase: '准备', vars: {} },
    zones: { deck: [], discardPile: [], processing: [] },
    settlementStack: [],
    atomStack: [],
    cardWrappers: {},
    rngSeed: 0,
    marks: [],
    localVars: {},
    meta: { gameId: '', createdAt: 0 },
    seq: 0,
    startedAt: 0,
    actionLog: [],
    ...partial,
    players,
  };
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

/** Atom 等待配置(pending)。有此字段 = 等待型 atom。apply 流程走完后进 pending 区。
 * 等待型 atom 不可被取消——必走完(响应/超时)之一(没有 drop 机制)。
 * `timeout` 与 `onTimeout` 都是必填,无合理默认值。*/
export interface AtomPending {
  /** 超时后的行为:一个 atom,和普通 apply 一样压栈执行。**必填**——典型 `{ type: '无操作' }` */
  onTimeout: Atom;
  /** 前端提示(告诉前端渲染什么 UI) */
  prompt: ActionPrompt;
  /** 超时毫秒。**必填**——无合理默认值,常见值:询问闪/询问杀 15s,请求回应 30s */
  timeout: number;
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

/** 前端视图事件——后端 atom 的前端投影。纯数据，可序列化。 */
export interface ViewEvent {
  /** 事件类型（与后端 atom type 一致，可按需别名，如 移动牌→弃牌） */
  type: string;
  /**
   * 原始 atom 类型。当 ViewEvent.type 与 atom.type 不同时设置，
   * 前端据此查找 AtomDefinition.applyView。
   * 相同时省略（前端 fallback 到 type）。
   */
  atomType?: string;
  /** 事件数据（已脱敏，只含前端需要的字段） */
  [key: string]: Json;
  /** 内联动画/音效 */
  effect?: AtomEffect;
  /** 等待信息（仅等待型 atom） */
  pending?: { startTime: number; deadline: number; prompt: ActionPrompt };
}

/** Per-player 视图分叉——toViewEvents 的返回值 */
export interface ViewEventSplit {
  /** 指定玩家看到的专属视图事件。值为 null = 该玩家看不到此事件 */
  ownerViews: ReadonlyMap<string, ViewEvent | null>;
  /** 其余玩家看到的通用视图事件。null = 其他人不感知此 atom */
  othersView: ViewEvent | null;
}

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
  // 初始化
  | { type: '抽身份'; playerCount: number; seed: number }
  | { type: '选将'; characters: Array<{ name: string; skills: string[] }>; seed: number }
  | { type: '初始化洗牌'; seed: number }
  | { type: '发牌'; handSize: number; lordBonus?: number }
  | { type: '判定'; player: string; judgeType: string }
  // 等待回应
  | { type: '无操作' }
  | { type: '询问闪'; target: string; source: string }
  | { type: '询问杀'; target: string; source: string }
  | { type: '请求回应'; requestType: string; target: string; prompt: ActionPrompt; defaultChoice?: Json; timeout?: number }
  // 牌包装(武圣转化)
  | { type: '武圣包装'; cardId: string }
  | { type: '武圣还原'; cardId: string };


export interface AtomDefinition<A = unknown> {
  type: string;
  validate(state: GameState, atom: A): string | null;
  apply(state: GameState, atom: A): void;
  pending?: AtomPending;
  /**
   * 将后端 atom 转换为前端可消费的视图事件。
   *
   * ⚠️ 在 apply 之前调用——此时 state 尚未变更，可以读取即将被消费的数据
   * （如摸牌前读取牌堆顶的牌面信息）。
   *
   * 返回 ViewEventSplit 实现 per-player 信息分级和参数脱敏。
   * ViewEvent 是纯数据（可序列化），不含函数。
   * 未实现 = fallback 到带 effect 的原始 atom（前端回退到全量 buildView）。 */
  toViewEvents?(state: GameState, atom: A): ViewEventSplit | undefined;
  /**
   * 前端视图状态更新。与后端 apply 对称——apply 修改 GameState，applyView 修改 GameView。
   *
   * 前端收到 ViewEvent 后，按 `event.atomType ?? event.type` 查找 AtomDefinition，
   * 调用此函数增量更新 GameView。
   * 未实现 = 前端回退到全量 buildView。
   */
  applyView?(view: GameView, event: ViewEvent): void;
  /** effect 作为 toViewEvents 未实现时的 fallback。 */
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

/**
 * 引擎原子操作管线说明:详见 src/engine/engine-api.ts。
 *
 * 新版"操作 gameState 的函数"全部为顶层 export,skill 通过 import 直接调用,
 * 参数显式传 state + 调用参数。例如:`applyAtom(state, atom)` / `pushFrame(state, ...)`。
 *
 * **EngineApi(旧闭包接口)保留** —— 仅为兼容少数 system skill(如 开局)使用。
 * 新代码请直接 import 顶层函数,不要创建 EngineApi 实例。
 */

/** before 钩子上下文:atom 执行前调用 */
export interface AtomBeforeContext {
  state: GameState;
  atom: Atom;
  /** 钩子注册时的 ownerId(skill 实例的所属玩家) */
  ownerId: string;
  /** 当前结算帧(只读) */
  readonly frame: SettlementFrame;
  /** 当前结算帧 params 的只读快照(回应数据通过 dispatch 注入) */
  readonly params: Record<string, Json>;
}

export interface AtomAfterContext {
  state: GameState;
  atom: Atom;
  /** 钩子注册时的 ownerId(skill 实例的所属玩家) */
  ownerId: string;
  /** 当前结算帧(只读) */
  readonly frame: SettlementFrame;
  /** 当前结算帧 params 的只读快照(回应数据通过 dispatch 注入) */
  readonly params: Record<string, Json>;
}

/**
 * 旧版 EngineApi 对象(给 skill 传闭包,内部用 state 闭包变量)。仅供兼容 system skill 使用。
 * 新代码请直接 import 顶层函数:参见 src/engine/engine-api.ts。
 */
export interface EngineApi {
  /** 当前 GameState(只读引用) */
  readonly state: GameState;
  /** 技能 ownerId(per player instance) */
  readonly self: string;
  /** 当前消息 params(由 dispatch 注入;回应路径的 params 在消费 pending 后更新) */
  readonly params: Record<string, Json>;
  /** 创建帧并压入 settlementStack,返回帧引用 */
  pushFrame(skillId: string, from: string, params?: Record<string, Json>): SettlementFrame;
  /** 弹出栈顶帧 */
  popFrame(): void;
  /** 取栈顶帧 */
  topFrame(): SettlementFrame | undefined;
  /** 应用一个 atom。等待型 atom 的 Promise 会挂起直到回应/超时 */
  apply(atom: Atom): Promise<void>;
  /** 推送 notify 事件(不改变 state) */
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

/**
 * 结算帧:execute 本地状态。
 * 帧是纯数据——所有"操作"通过 EngineApi(apply/notify)进行。
 * 技能通过 api.pushFrame 创建并压入 settlementStack;技能负责 api.popFrame 配对弹出。
 *
 * `params` 原则上只读(在 pushFrame 时初始化一次,后续不允许修改)。
 * 跨 atom 通信(尤其是父 action 读 respond 结果)走 state 观察(zones/tags/marks/localVars),
 * 不通过此字段。
 *
 * **临时过渡**:目前 TS 未强制 readonly——旧 skill 仍通过 mutation 写 __Xxx 字段。
 * 新 skill 应通过 state 观察(stage B 后续统一改造时再改 readonly)。
 */
export interface SettlementFrame {
  skillId: string;
  from: string;
  /** execute 本地初始参数(跨 atom 共享的配置,如 cardId/targets 列表)。
   *  pushFrame 时初始化一次。**原则上只读**——新代码不要 mutate。 */
  params: Record<string, Json>;
  /** 处理区(此帧涉及的牌 ID 列表) */
  cards: string[];
}

/** Pending 区——等待玩家操作的 slot */
export interface PendingSlot {
  atom: Atom;
  definition: AtomDefinition;
  startTime: number;
  deadline: number;
  resolve: () => void;
  /** 内部:由 engine-api 在创建 pending 时挂上,供 engine.fireTimeout 立即触发 onTimeout。
   *  属于引擎内部钩子,不属于 PendingSlot 对外契约(下划线前缀 + 可选)。 */
  _fireTimeoutNow?: () => Promise<void>;
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
  /**
   * 验证消息合法性:返回 null 表示通过,返回字符串为错误信息。
   * ownerId 已在 entry.ownerId 上,无需重复传入。
   */
  validate: (state: GameState, params: Record<string, Json>) => string | null;
  /**
   * 技能 execute:顶层函数式 API。
   * ownerId 已在 entry.ownerId 上,无需重复传入。
   */
  execute: (state: GameState, params: Record<string, Json>) => Promise<void>;
}

export interface AtomHookEntry {
  skillId: string;
  ownerId: string;
  atomType: string;
  phase: 'before' | 'after';
  handler: (ctx: AtomBeforeContext | AtomAfterContext) => Promise<void>;
}

// ==================== SkillDef ====================

/**
 * 旧 BackendAPI(给 onInit 传闭包)已删除。
 * 新版 onInit 签名:`(skill: Skill, ownerId: string) => (() => void) | void`。
 * skill 内部直接 import { registerAction, registerBeforeHook, registerAfterHook } from '../skill'
 * 并调用,ownerId 由 onInit 第二参数注入。
 */
export interface SkillModule {
  createSkill: (id: string, ownerId: string) => Skill;
  onInit?: (skill: Skill, ownerId: string) => (() => void) | void;
  onMount?: (skill: Skill, api: FrontendAPI) => (() => void) | void;
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
  | { kind: 'atom'; atom: Atom; viewEvents?: ViewEventSplit }
  | { kind: 'notify'; skillId: string; eventType: string; data: Json; views?: ReadonlyMap<string, Json> };