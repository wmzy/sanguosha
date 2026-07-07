// src/engine/types.ts
// 新引擎类型定义。详见 docs/ENGINE-DESIGN.md §3-7

import type { Color, DamageType } from '../shared/types';

/** 系统级 owner / target:不对应任何真实玩家槽位(开局 action、无来源伤害)。 */
export const TARGET_SYSTEM = -1;
/** 广播型 target:所有存活玩家都可回应(无懈可击询问)。 */
export const TARGET_BROADCAST = -2;

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type Card = {
  id: string;
  name: string;
  suit: '♠' | '♥' | '♣' | '♦' | '';
  /** 颜色，独立于花色。转化合成卡(多张)为'无色'。 */
  color: Color;
  rank: string;
  type: '基本牌' | '锦囊牌' | '装备牌';
  subtype?: string;
  /** 卡牌描述 */
  description?: string;
  /** 锦囊子类型 */
  trickSubtype?: '普通锦囊' | '延时锦囊' | '响应锦囊';
  /** 武器攻击范围(仅武器装备牌)。徒手默认 1,由 distance.ts 兜底 */
  range?: number;
  /** 伤害属性(仅杀牌/伤害锦囊有意义):火焰/雷电触发铁索连环传导 */
  damageType?: DamageType;
  /**
   * 影子卡牌:若设置,本 Card 是由 shadowOf 指向的原卡"转化"而来(如武圣红牌当杀)。
   * name/suit/rank 是转化后的视图;原卡仍在 cardMap[shadowOf]。
   * 影子离开结算(入弃牌堆)时,引擎用 shadowOf 还原为原卡。 */
  shadowOf?: string;
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
  source: number;
  card: Card;
}

export type Identity = '主公' | '忠臣' | '反贼' | '内奸';
export type Faction = '魏' | '蜀' | '吴' | '群';
export type Gender = '男' | '女';

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
   *  createGameState 保证初始化为空数组 */
  tags: string[];
  /** 判定区:延时锦囊的 cardId 列表(乐不思蜀/闪电/兵粮寸断)。可选,未设置视同空数组 */
  judgeZone?: string[];
  /** 身份局角色身份。主公开局亮明,其他角色死亡时翻开 */
  identity?: Identity;
  /** 武将势力(魏蜀吴群),影响部分技能(如激将、无懈可击·国) */
  faction?: Faction;
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
  /** 当前等待中的 pending slots,按被问询玩家 target 索引。
   *
   * 单 target 询问(出牌期间询问闪/杀/弃牌等):Map size=1。
   * 多 target 并行询问(拼点/选将):Map size=2+,各 target 独立 respond、独立 resolve,
   * 互不阻塞,全部 resolve 后父 execute 继续(`await Promise.all`)。
   *
   * target 为特殊值时:key 用负数(TARGET_SYSTEM=-1=系统, TARGET_BROADCAST=-2=广播竞态如无瓣可击)。 */
  pendingSlots: Map<number, PendingSlot>;
  cardMap: Record<string, Card>;
  cardWrappers: Record<string, CardWrapper>;
  rngSeed: number;
  marks: Mark[];
  localVars: Record<string, Json>;
  meta: { gameId: string; createdAt: number };
  /** 房间级游戏配置(由 session 在 create 时注入)。原子操作/视图层据此调整超时等行为。
   *  timeoutScale: pending 超时倍率。1=默认, <1 更快, >1 更慢, Infinity=无限。
   *  若未设置(旧测试 state)按默认 1 处理。 */
  config?: { timeoutScale: number };
  seq: number;
  startedAt: number;
  actionLog: ActionLogEntry[];

  /** 引擎唯一权威事件源：apply 时写入 atom + 缓存的 ViewEventSplit。
   *  session 据此为任意 viewer 派生事件序列（广播/重连差量）。
   *  永不清空——每局几百条，内存 <1MB，换取重连差量推送正确性。 */
  atomHistory: AppliedAtomEntry[];

  /** state 变更回调:每次 applyAtom 完成(pushEvent 后)触发。
   *  session 订阅后据此广播 view,不再 await dispatch。fire-and-forget 模型下
   *  dispatch 返回时 execute 可能还在跑,广播时机由本回调驱动。 */
  onStateChange?: () => void;

  /** 引擎错误回调:execute fire-and-forget 抛错时触发。
   *  session 订阅后记录完整堆栈,避免错误被静默吞掉。
   *  fire-and-forget 的 execute promise 无人 await,其 rejection 只能通过此回调暴露。 */
  onError?: (error: Error) => void;
}

/** 创建 GameState 的统一工厂。缺失字段自动补默认值 */
export function createGameState(
  partial: Partial<GameState> & { players: PlayerState[]; cardMap: Record<string, Card> },
): GameState {
  // 兜底:为缺失 tags 字段的 players 补默认值(tags 是必填,但外部构造 PlayerState 时可能遗漏)
  const players = partial.players.map((p): PlayerState => (p.tags ? p : { ...p, tags: [] }));
  return {
    currentPlayerIndex: 0,
    phase: '准备',
    turn: { round: 1, phase: '准备', vars: {} },
    zones: { deck: [], discardPile: [], processing: [] },
    settlementStack: [],
    atomStack: [],
    pendingSlots: new Map(),
    cardWrappers: {},
    rngSeed: 0,
    marks: [],
    localVars: {},
    meta: { gameId: '', createdAt: 0 },
    seq: 0,
    startedAt: 0,
    actionLog: [],
    atomHistory: [],
    ...partial,
    players,
  };
}

// ==================== ActionPrompt ====================

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
  | ChooseSuitPrompt;

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

// ==================== Atom ====================

/** Atom 等待配置(pending)。有此字段 = 等待型 atom。apply 流程走完后进 pending 区。
 等待型 atom 不可被取消——必走完(响应/超时)之一(没有 drop 机制)。
 `timeout` 与 `onTimeout` 都是必填,无合理默认值。 */
export interface AtomPending<A = Atom> {
  /** 超时后的行为。**必填**——一个 async 函数,引擎在 slot 超时时调用。
   *  内部可自由编排 applyAtom(支持多步操作),每个 applyAtom 照常走完整 pipeline(hooks 正常触发)。
   *  典型:无副作用 `async () => {}`;自动弃牌 `async (s, a) => { await applyAtom(s, 弃牌atom) }` */
  onTimeout: (state: GameState, atom: A) => Promise<void>;
  /** 前端提示(告诉前端渲染什么 UI) */
  prompt: ActionPrompt;
  /** 超时毫秒。**必填**——无合理默认值,常见值:询问闪/询问杀 15s,请求回应 30s */
  timeout: number;
  /** 是否为阻塞型 pending(需要玩家先回应才能继续)。默认 true。
   *  非阻塞型 pending 表示一个"控制权 token"——玩家可在其期间自由操作(如出牌阶段的 出牌窗口),
   *  出牌/用技的 validate 只检查阻塞型 pending。 */
  isBlocking?: boolean;
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

/** 前端视图事件——后端 atom 的前端投影。纯数据，可序列化。
 *  索引签名值类型用 unknown 而非 Json:pending 内含 ActionPrompt
 *  (带函数类型),非纯 Json;各 atom 塞任意字段,前端 applyView 用 as 断言读取。
 *  动画/音效(effect)不下发,前端通过 AtomDefinition.effect 静态查表获取。 */
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
  [key: string]: unknown;
  /** 等待信息（仅等待型 atom） */
  pending?: { startTime: number; deadline: number; prompt: ActionPrompt };
}

/** Per-player 视图分叉——toViewEvents 的返回值。key 是座次下标(引擎只认座次) */
export interface ViewEventSplit {
  /** 指定玩家看到的专属视图事件。值为 null = 该玩家看不到此事件 */
  ownerViews: ReadonlyMap<number, ViewEvent | null>;
  /** 其余玩家看到的通用视图事件。null = 其他人不感知此 atom */
  othersView: ViewEvent | null;
}

export type ZoneLoc =
  | { zone: '牌堆' }
  | { zone: '弃牌堆' }
  | { zone: '手牌'; player: number }
  | { zone: '处理区' };

export type Atom =
  // 卡牌/资源
  | { type: '摸牌'; player: number; count: number }
  | { type: '弃置'; player: number; cardIds: string[] }
  | { type: '移动牌'; cardId: string; from: ZoneLoc; to: ZoneLoc }
  | { type: '获得'; player: number; cardId: string; from?: number }
  | { type: '给予'; cardId: string; from: number; to: number }
  | { type: '装备'; player: number; cardId: string }
  | { type: '卸下'; player: number; slot: EquipSlot }
  | { type: '洗牌' }
  | { type: '重洗' }
  | { type: '整理牌堆'; cards: string[] }
  // 角色状态
  | { type: '造成伤害'; target: number; amount: number; source: number; cardId?: string; damageType?: DamageType }
  | { type: '回复体力'; target: number; amount: number; source?: number }
  | { type: '失去体力'; target: number; amount: number }
  | { type: '陷入濒死'; target: number }
  | { type: '击杀'; player: number }
  // 标记/状态
  | { type: '加标记'; player: number; mark: Mark }
  | { type: '去标记'; player: number; markId: string }
  | { type: '清过期标记'; player: number }
  | { type: '设横置'; player: number; chained: boolean }
  | { type: '设上限'; player: number; amount: number }
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
  // 目标
  | { type: '指定目标'; source: number; cardId?: string; target: number }
  | { type: '成为目标'; source: number; cardId?: string; target: number }
  // 判定
  | { type: '添加延时锦囊'; player: number; trick: PendingTrick }
  | { type: '移除延时锦囊'; player: number; trickName: string }
  // 拼点
  | { type: '拼点'; initiator: number; target: number; initiatorCard: string; targetCard: string }
  // 初始化
  | { type: '抽身份'; playerCount: number; seed: number }
  | {
      type: '选将询问';
      target: number;
      candidates: Array<{ name: string; skills: string[] }>;
      prompt?: ActionPrompt;
    }
  | {
      type: '并行选将';
      selections: Array<{ target: number; candidates: Array<{ name: string; skills: string[] }> }>;
    }
  | { type: '分配武将'; target: number; character: string; skills: string[] }
  | { type: '初始化洗牌'; seed: number }
  | { type: '发牌'; handSize: number; lordBonus?: number }
  | { type: '判定'; player: number; judgeType: string }
  // 使用结算时机(通用:杀/锦囊等)
  | { type: '检测有效性'; source: number; target: number; cardId: string }
  | { type: '被抵消'; source: number; target: number; cardId: string }
  // 等待回应
  | { type: '询问闪'; target: number; source: number }
  | { type: '询问杀'; target: number; source: number }
  | {
      type: '请求回应';
      requestType: string;
      target: number;
      prompt: ActionPrompt;
      defaultChoice?: Json;
      timeout?: number;
      /** 仅用于 requestType='无懈可击':本次无懈抵消的目标座次(-1=整体抵消/单目标锦囊,N=全体锦囊的某个目标)。
       * 无懈 respond execute 据此翻转 localVars[`无懈/被抵消/${cancelTarget}`]。 */
      cancelTarget?: number;
    }
  // 多目标并行盲选(拼点/选将):为每个 target 创建独立 slot,各独立 resolve
  | {
      type: '并行回应';
      requestType: string;
      targets: number[];
      prompt: ActionPrompt;
      defaultChoice?: Json;
      timeout?: number;
    }
  // 出牌阶段的控制权 token——非阻塞型 pending,表示"当前玩家可自由出牌/用技"。
  // 玩家每次操作都 resolve 它(重建),超时则结束回合。不计入 hasBlockingPending。
  | { type: '出牌窗口'; player: number; timeout?: number }
  // 转化包装:将 N 张手牌当【杀】使用(武圣/丈八蛇矛等通用)
  | { type: '当作'; player: number; cardIds: string[]; shadowId: string; outputName: string }
  // 结算帧管理(走 atom 管线,保证前后端 settlementStack 同步)
  | { type: '结算帧入栈'; skillId: string; from: number; params?: Record<string, Json> }
  | { type: '结算帧出栈' }
  // 结算帧 params 变更(走 atom,保证前端同步)
  | { type: '帧参数赋值'; key: string; value: Json }
  // 回合用量(view 同步):出杀计数/限一次标记同步到前端 turnUsage
  | { type: '回合用量'; player: number; key: string; value: Json }
  // 周泰·不屈:牌堆顶一张牌作为"创"牌置于武将牌上
  | { type: '置创牌'; player: number };

export interface AtomDefinition<A = unknown> {
  type: string;
  validate(state: GameState, atom: A): string | null;
  apply(state: GameState, atom: A): void;
  /**
   * atom 自身的后处理——在所有技能 after hooks 执行完毕后调用。
   * 用于清理 atom 创建的临时状态(如判定牌从处理区移入弃牌堆)。
   * 与技能 after hooks 区分:这是 atom 定义自身的职责,不是技能 hook。
   */
  afterHooks?(state: GameState, atom: A): void;
  pending?: AtomPending<A>;
  /** 并行等待型 atom:声明如何拆分为多个单-target slot。
   *  引擎据此自动拆分,无需硬编码偏序判断。未实现 = 单 target。
   *  返回值中的 slotAtom 作为子 slot 的 atom,会使用自身 type 对应的 def 做 pending。
   *  典型场景:并行回应(拆成 请求回应)、并行选将(拆成 选将询问)。 */
  parallelSplit?: (atom: A) => Array<{ target: number; slotAtom: Atom }>;
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
  /**
   * 前端根据 ViewEvent 生成游戏日志条目。纯展示层，不在网络传输中携带。
   * ViewEvent 已含生成日志所需的所有数据（player/target/amount/cardName 等）。
   *
   * event 已经过 toViewEvents 分叉:当前视角能看到的字段（如 owner 的摸牌 cards）
   * 已包含在 event 中。viewer 为当前视角座次，便于进一步判断「我」相关文案。
   * 返回 null 表示该事件不写日志。
   */
  toViewLog?(event: ViewEvent, viewer: number): { player: number; text: string } | null;
}
export interface GameView {
  viewer: number;
  currentPlayerIndex: number;
  phase: TurnPhase;
  turn: { round: number; phase: TurnPhase; vars: Record<string, Json> };
  players: {
    index: number;
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
    identity?: string;
    /** 该玩家的身份已分配但当前视角不可见。identity 为 undefined 时,
     *  若 identityHidden=true 则显示「暗」,否则不渲染身份徽章(尚未分配)。 */
    identityHidden?: boolean;
    /** 距离修正 vars(只投影距离相关的三个 key,不暴露身份等敏感 vars)。
     *  供前端 distance.ts 与引擎 distance.ts 用同一套数据计算距离。 */
    distanceVars?: {
      attackMod?: number;
      defenseMod?: number;
      attackRange?: number;
    };
    /** 判定区(延时锦囊)。元素为 cardId,通过 cardMap 查 Card */
    pendingTricks?: string[];
    /** 本回合用量(前端禁用超限/已用操作,与后端 validate 一致)。
     *  数字 key = 已用次数(如 '杀/usedCount');真值 key = 限一次标记(如 '制衡/usedThisTurn')。
     *  由「回合用量」atom 的 applyView 增量维护,buildView 投影初值,回合结束清空。
     *  这是后端 turn.vars/player.vars 中限次相关 key 的 view 侧投影——
     *  processedView 不增量维护原始 vars,故单独同步此派生字段。 */
    turnUsage?: Record<string, Json>;
  }[];
  cardMap: Record<string, Card>;
  pending: PendingView | null;
  /** 当前 pending slot 的超时截止时间戳(出牌阶段的 __出牌 询问、询问闪/弃牌等)。
   *  无 pending 时为 null。 */
  deadline: number | null;
  /** deadline 对应的倒计时总时长(ms);deadline 为 null 时无意义 */
  deadlineTotalMs: number;
  log: { time: number; player: number; text: string }[];
  /** 公共区域摘要(供前端渲染牌堆/弃牌堆/处理区) */
  zones?: {
    /** 牌堆剩余牌数 */
    deckCount: number;
    /** 弃牌堆数量 */
    discardPileCount: number;
    /** 处理区的卡牌(判定/出杀等中间结算)。元素为 cardId */
    processing: string[];
  };
  /** 结算帧栈(投影 state.settlementStack)。玩家视角可见的全部结算上下文。
   *  通过「结算帧入栈/出栈」atom 同步到前端,与后端状态一致。 */
  settlementStack: SettlementFrame[];
}

/**
 * 引擎原子操作管线说明:
 *
 * "操作 gameState 的函数"全部为顶层 export,skill 通过 import 直接调用,
 * 参数显式传 state + 调用参数。例如:`applyAtom(state, atom)` / `pushFrame(state, ...)`。
 */

/**
 * before 钩子对当前 atom 的干预结果。
 * - pass:不干预,管线继续(默认;返回 void 也视为 pass)
 * - modify:修改 atom 参数,管线用新 atom 继续 validate/apply。后续 before 钩子收到修改后的 atom。
 *   典型:藤甲减伤、护甲减伤、酒加伤——叠加生效(座次序)。
 * - cancel:取消当前 atom,不进入 validate/apply/after hooks。
 *   典型:仁王盾黑杀无效、寒冰剑改为弃牌、检测有效性目标无效。后续 before 钩子不再跑。
 *   cancel 是确定性事件:管线推一个 notify 事件让前端感知(非静默)。
 *   调用方可通过 applyAtom 返回值(false)感知 cancel,据此跳过后续逻辑(如杀跳过无效目标)。
 */
export type HookResult = { kind: 'pass' } | { kind: 'modify'; atom: Atom } | { kind: 'cancel' };

/** before 钩子上下文:atom 执行前调用 */
export interface AtomBeforeContext {
  state: GameState;
  atom: Atom;
  /** 钩子注册时的 ownerId(skill 实例的所属玩家,座次下标) */
  ownerId: number;
  /** 当前结算帧(只读) */
  readonly frame: SettlementFrame;
  /** 当前结算帧 params 的只读快照(回应数据通过 dispatch 注入) */
  readonly params: Record<string, Json>;
}

export interface AtomAfterContext {
  state: GameState;
  atom: Atom;
  /** 钩子注册时的 ownerId(skill 实例的所属玩家,座次下标) */
  ownerId: number;
  /** 当前结算帧(只读) */
  readonly frame: SettlementFrame;
  /** 当前结算帧 params 的只读快照(回应数据通过 dispatch 注入) */
  readonly params: Record<string, Json>;
}

// ==================== Skill ====================

export interface Skill {
  id: string;
  ownerId: number;
  name: string;
  description: string;
}

export interface PendingView {
  type: 'awaits';
  atom: Atom;
  prompt: ActionPrompt;
  target: number;
  /** 是否为阻塞型 pending(需玩家回应)。非阻塞型(如出牌阶段的出牌窗口)在前端不计入 awaiting 判断。 */
  isBlocking?: boolean;
  /** 由 events 消息权威下发;applyView 不再硬编码 */
  deadline?: number;
  /** 倒计时总时长(ms),前端进度条用 deadline-totalMs..deadline 映射;由 events 消息权威下发 */
  totalMs?: number;
}

/**
 * 结算帧:execute 本地状态。纯数据——所有状态变更通过顶层函数 applyAtom/pushNotify。
 * 技能通过 pushFrame 创建并压入 settlementStack;技能负责 popFrame 配对弹出。
 *
 * `params` 的两层语义:
 *  - **配置数据**(cardId/targets 等):pushFrame 时初始化,后续只读。
 *  - **可变结算状态**(如 resolvedTargets):允许 mutate 数组元素(引用语义),
 *    用于被动技能在 hook 中修改结算目标。典型:流离在 成为目标 after hook 中
 *    改写 frame.params.resolvedTargets[i],杀在后续结算循环读到新目标。
 *    这种 mutate 绑定在特定帧上,天然支持嵌套(南蛮→杀→流离 各有独立帧),
 *    优于迁到全局 localVars(会被嵌套同名帧覆盖)。
 *  - 不要替换 params 对象本身,只改内部字段。
 *
 * 跨 atom 通信的一般途径是 state 观察(zones/tags/marks/localVars);
 * params 的可变字段是针对"结算目标在 hook 中被改写"这一场景的特设机制。
 */
export interface SettlementFrame {
  skillId: string;
  from: number;
  /** execute 本地参数。pushFrame 时初始化;配置字段只读,resolvedTargets 等可变字段允许 mutate 元素。 */
  params: Record<string, Json>;
  /** 本帧的牌区(替代全局 zones.processing)。牌的进出通过 移动牌 atom({ zone: '处理区' }) 隐式操作栈顶帧的此字段。
   *  嵌套结算时各帧各自独立——天然隔离,无需 find(name) 脆弱区分。 */
  cards: string[];
}

/** Pending 区——等待玩家操作的 slot */
export interface PendingSlot {
  atom: Atom;
  definition: AtomDefinition;
  startTime: number;
  deadline: number;
  /** 是否为阻塞型 pending。非阻塞型(出牌窗口)不阻止玩家出牌/用技,不计入 hasBlockingPending。 */
  isBlocking: boolean;
  /** 创建时的 state.seq，作为 pending 窗口版本号。
   *  respond 路径用 action.pendingSeq 与此对比：不匹配 = 响应了过期窗口 → 拒绝。
   *  close-reopen 时新 slot 会有新 createdSeq。 */
  createdSeq: number;
  resolve: () => void;
  /** 超时定时器是否已触发(已被 fireTimeout 接管)。dispatch 据 this 丢弃竞态中的用户 action */
  isTimeout: boolean;
  /** 取消超时定时器(不触发)。dispatch 走用户 action 路径前调用,让 respond execute 独占推进 */
  pause: () => void;
  /** 内部:由引擎创建 pending 时挂上,供 fireTimeout 立即触发 onTimeout(绕过真实 setTimeout) */
  _fireTimeoutNow?: () => Promise<void>;
}

export interface ClientMessage {
  skillId: string;
  actionType: string;
  ownerId: number;
  params: Record<string, Json>;
  baseSeq: number;
  /** 可选：respond 响应的 pending 窗口 seq。
   *  服务端校验 slot.createdSeq === pendingSeq：不匹配 = 响应了过期窗口 → 拒绝。
   *  主动 action 不带此字段（不影响）。 */
  pendingSeq?: number;
  /**
   * 可选:在主 action 前顺序执行的前置 action 序列(转化类)。
   * dispatch 逐个 validate+execute;主 action validate 失败时,对已执行的 preceding
   * 按逆序调用 rollback 恢复 state。典型:武圣转化(红牌→杀) 在 杀.use 之前。
   */
  preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>;
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
  ownerId: number;
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
  /**
   * 可选:回滚 execute 的副作用。仅"可组合 action"(用于 preceding)需要实现。
   * dispatch 执行 preceding 序列时,若主 action 或后续 preceding 的 validate 失败,
   * 对已执行的 preceding 按逆序调用 rollback,恢复 state。
   * 普通非组合 action 不实现(undefined)。
   */
  rollback?: (state: GameState, params: Record<string, Json>) => void;
}

export interface AtomHookEntry {
  skillId: string;
  ownerId: number;
  atomType: string;
  phase: 'before' | 'after';
  /** before 钩子可返回 HookResult(pass/modify/cancel);after 钩子返回 void */
  handler: (ctx: AtomBeforeContext | AtomAfterContext) => Promise<HookResult | void>;
}

// ==================== SkillDef ====================

/**
 * 旧 BackendAPI(给 onInit 传闭包)已删除。
 * 新版 onInit 签名:`(skill: Skill, ownerId: number) => (() => void) | void`。
 * ownerId 是座次下标(与 PlayerState.index 一致)。
 * skill 内部直接 import { registerAction, registerBeforeHook, registerAfterHook } from '../skill'
 * 并调用,ownerId 由 onInit 第二参数注入。
 */
export interface SkillModule {
  createSkill: (id: string, ownerId: number) => Skill;
  onInit?: (skill: Skill, state: GameState) => (() => void) | void;
  onMount?: (skill: Skill, api: FrontendAPI) => (() => void) | void;
}

export interface FrontendAPI {
  viewer: number;
  onEvent(handler: (event: GameEvent, view: GameView) => void): () => void;
  defineAction(
    actionType: string,
    opts: {
      label: string;
      style?: 'primary' | 'danger' | 'default' | 'passive';
      prompt: ActionPrompt;
      transform?: (card: Card) => CardWrapper;
      /** 激活谓词:声明该 action 何时该被前端渲染为可交互控件。
       *  缺省(undefined)时的语义由前端集中实现:出牌类(use)缺省 = 出牌阶段+当前视角回合+无 pending。
       *  主动技(confirm/distribute/转化)按需声明更宽或更窄的条件。 */
      activeWhen?: ActionActiveWhen;
    },
  ): void;
  playEffect(effect: AtomEffect): void;
}

export type GameEvent =
  | { kind: 'atom'; seq: number; atom: Atom; viewEvents?: ViewEventSplit }
  | {
      kind: 'notify';
      seq: number;
      skillId: string;
      eventType: string;
      data: Json;
      views?: ReadonlyMap<string, Json>;
    };

/** 引擎唯一权威事件源条目。apply 时写入，不可变。
 *  替代旧的模块级 event-stream 单例。 */
export type AppliedAtomEntry =
  | { kind: 'atom'; seq: number; timestamp: number; atom: Atom; viewEvents: ViewEventSplit }
  | {
      kind: 'notify';
      seq: number;
      timestamp: number;
      skillId: string;
      eventType: string;
      data: Json;
      views?: ReadonlyMap<string, Json>;
    };

/** 事件 envelope(per-viewer 已分叉)。session 广播用。
 *  从 engine/types 导出避免 engine→server 循环依赖。 */
export interface GameEventEnvelope {
  seq: number;
  /** 事件 timestamp,相对 game startedAt */
  timestamp: number;
  /** atom 事件(per-viewer 分叉后的视图事件) */
  view?: ViewEvent;
  /** 通知事件(per-viewer 分叉后的 data) */
  notify?: { skillId: string; eventType: string; data: Json };
}
