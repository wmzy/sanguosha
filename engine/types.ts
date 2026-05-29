import type { Card, Effect, GameState, TurnPhase } from '../shared/types';
import type { Rng } from '../shared/rng';

export interface GameEvent {
  type: string;
  player?: string;
  target?: string;
  attacker?: string;
  amount?: number;
  card?: Card;
  phase?: TurnPhase;
  data?: unknown;
}

export type HookHandler = (game: GameState, event: GameEvent) => Effect[];

export type EffectExecutor = (
  game: GameState,
  effect: Effect,
  ctx: EffectExecContext,
) => GameState;

export interface EffectExecContext {
  player: string;
  target?: string;
  card?: Card;
  damageSourceCard?: Card;
  attacker?: string;
  amount?: number;
  rng: Rng;
  _judgeCard?: Card;
  _skipFlags?: SkipFlags;
}

export interface SkipFlags {
  draw: boolean;
  phases: Set<TurnPhase>;
}

export interface SkillAvailability {
  name: string;
  description: string;
  index: number;
  canUse: boolean;
  targetRequired: boolean;
  effect: Effect;
}

export interface ValidActions {
  playableCards: Array<{ card: Card; targets: string[] }>;
  skills: SkillAvailability[];
  canEndTurn: boolean;
  discardRequired: boolean;
  discardCount: number;
}

export interface ActionResult {
  success: boolean;
  state: GameState;
  events: GameEvent[];
  responseWindow?: ResponseWindow;
}

export interface ResponseWindow {
  type: 'kill_response' | 'trick_response' | 'dying' | 'aoe_response';
  requester: string;
  validResponders: string[];
  validCards: string[];
  sourceCard?: Card;
  onResolve: (game: GameState, responses: Map<string, Card | null>) => GameState;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}
