// View 类型:前端投影 GameView + PendingView。
// 原 src/engine/types.ts 中 GameView 接口与 PendingView(原 Skill 段)。

import type { Card, EquipSlot, Faction, Json, Mark, TurnPhase } from './state';
import type { SettlementFrame } from './skill';
import type { Atom } from './atom';
import type { ActionPrompt } from './prompt';

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
    /** 武将势力(魏蜀吴群),公开信息,与 character 一并由 分配武将 atom 下发。
     *  影响激将/护驾/黄天/救援/暴虐/颂威/制霸等势力相关技能。 */
    faction?: Faction;
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
