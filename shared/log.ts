export type OperationType =
  | '摸牌'
  | '弃置'
  | '出牌'
  | '造成伤害'
  | '受到伤害'
  | '回复体力'
  | '失去体力'
  | '击杀'
  | '濒死'
  | '装备'
  | '装备效果'
  | '卸下'
  | '移动牌'
  | '获得'
  | '给予'
  | '失去牌'
  | '判定'
  | '判定结果'
  | '洗牌'
  | '重洗'
  | '整理牌堆'
  | '设阶段'
  | '下一玩家'
  | '回合开始'
  | '回合结束'
  | '阶段开始'
  | '阶段结束'
  | '加技能'
  | '去技能'
  | '技能发动'
  | '技能选择'
  | '加标记'
  | '去标记'
  | '清过期标记'
  | '加标签'
  | '去标签'
  | '加延时锦囊'
  | '移除延时锦囊'
  | '推入待定'
  | '弹出待定'
  | '设横置'
  | '设上限'
  | '设置变量'
  | '增加变量'
  | '清空变量'
  | '设置上下文变量'
  | '指定目标'
  | '成为目标'
  | '解决'
  | '拼点'
  | '杀命中'
  | '杀被闪避'
  | '装备变动'
  | '游戏开始'
  | '游戏结束'
  | '阶段变更'
  | '回合变更';

export interface Operation {
  seq: number;
  timestamp: number;
  type: OperationType;
  data: unknown;
  description: string;
}

export interface GameLog {
  meta: {
    version: string;
    createdAt: number;
    playerCount: number;
    characters: string[];
    seed: number;
  };
  serverOps: Operation[];
  playerOps: Record<string, Operation[]>;
  /** 完整服务端事件流（用于 ReplayEngine 重建状态） */
  serverLog?: Array<{ id: string; type: string; timestamp: number; payload: unknown }>;
}

export interface DrawData {
  player: string;
  cards: Array<{ name: string; suit: string; rank: string }>;
}

export interface PlayData {
  player: string;
  card: { name: string; suit: string; rank: string };
  target?: string;
}

export interface DamageData {
  source: string;
  target: string;
  amount: number;
  cardName?: string;
}

export interface HealData {
  player: string;
  amount: number;
  newHealth: number;
}

export interface DiscardData {
  player: string;
  cards: Array<{ name: string; suit: string; rank: string }>;
}

export interface TurnChangeData {
  from: string;
  to: string;
  round: number;
}

export interface PhaseChangeData {
  phase: string;
  player: string;
}

export interface ShuffleData {
  deckSize: number;
}

export interface GameStartData {
  players: Array<{ name: string; character: string; role: string }>;
}

export interface GameEndData {
  winner: string;
  reason: string;
}
