export type OperationType =
  | 'shuffle'
  | 'draw'
  | 'play'
  | 'discard'
  | 'damage'
  | 'heal'
  | 'equip'
  | 'phaseChange'
  | 'turnChange'
  | 'skillActivate'
  | 'gameStart'
  | 'gameEnd';

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
}

export interface DrawData {
  player: string;
  cards: Array<{ name: string; 花色: string; 点数: string }>;
}

export interface PlayData {
  player: string;
  card: { name: string; 花色: string; 点数: string };
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
  cards: Array<{ name: string; 花色: string; 点数: string }>;
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
