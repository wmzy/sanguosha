// 引擎状态类型:基础类型/枚举/常量 + PlayerState/GameState + 工厂。
// 详见 docs/ENGINE-DESIGN.md §3-7。原 src/engine/types.ts 按域拆分,本文件经 barrel(types/index.ts)统一导出。

import type { Color, DamageType } from '../../shared/types';
import type { Atom } from './atom';
import type { ActionLogEntry, AppliedAtomEntry, PendingSlot, SettlementFrame } from './skill';

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

  /** 调试开关:置为 true 时,applyAtom 在每个「正常完成」路径调用
   *  assertCardInvariants,护栏「同一张牌出现在多个区」的重复 bug。
   *  默认关闭(undefined),不影响现有对局与全量测试性能。 */
  assertInvariants?: boolean;
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
