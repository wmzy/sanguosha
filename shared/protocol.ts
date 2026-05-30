import type { TurnPhase, Card, Role, Gender, Faction, PendingTrick } from './types';

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
}

export interface ClientGameState {
  self: string;
  players: Record<string, ClientPlayer>;
  phase: TurnPhase;
  currentPlayer: string;
  turn: { killsPlayed: number };
}

export type GameAction =
  | { type: 'playCard'; player: string; cardId: string; target?: string }
  | { type: 'respond'; player: string; cardId?: string }
  | { type: 'endTurn'; player: string }
  | { type: 'discard'; player: string; cardIds: string[] }
  | { type: 'useSkill'; player: string; skillId: string; target?: string }
  | { type: 'skillChoice'; player: string; choice: unknown };

export interface PromptOption {
  label: string;
  value: unknown;
}

export interface PendingView {
  type: string;
  prompt: string;
  options?: PromptOption[];
  validCards?: string[];
  timeout: number;
  deadline: number;
}

export interface PlayerEvent {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
}

export interface GameView {
  state: ClientGameState;
  pending?: PendingView;
  actions: ValidAction[];
}

export interface PlayableCard {
  cardId: string;
  targets: string[];
}

export interface AvailableSkill {
  skillId: string;
  name: string;
  description: string;
  targets?: string[];
  canActivate: boolean;
  reason?: string;
}

export type ValidAction =
  | { type: 'playCard'; prompt: string; cards: PlayableCard[] }
  | { type: 'respond'; prompt: string; required: boolean; cards: string[]; canPass: boolean }
  | { type: 'useSkill'; prompt: string; skills: AvailableSkill[] }
  | { type: 'discard'; prompt: string; min: number; max: number; cards: string[] }
  | { type: 'skillChoice'; prompt: string; options: PromptOption[] }
  | { type: 'endTurn'; prompt: string };

export type ServerMessage =
  | { type: 'gameView'; view: GameView }
  | { type: 'events'; events: PlayerEvent[] }
  | { type: 'error'; message: string }
  | { type: 'gameOver'; winner: string };

export type ClientMessage =
  | { type: 'action'; action: GameAction }
  | { type: 'reconnect'; lastEventId: string }
  | { type: 'join'; playerName: string };
