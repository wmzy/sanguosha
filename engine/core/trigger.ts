import type { GameState, Effect, Card, TurnPhase } from '../../shared/types';

// Game events that can trigger skills
export interface GameEvent {
  type: 'turnStart' | 'turnEnd' | 'phaseStart' | 'phaseEnd' | 'damageReceived' | 'damageDealt' | 'cardPlayed' | 'dying' | 'death';
  player?: string;
  target?: string;
  attacker?: string;
  amount?: number;
  card?: Card;
  phase?: TurnPhase;
}

// Hook handler returns effects to execute
export type HookHandler = (game: GameState, event: GameEvent) => Effect[];

export class TriggerSystem {
  private hooks = new Map<string, HookHandler[]>();

  on(eventType: string, handler: HookHandler): void {
    const existing = this.hooks.get(eventType) ?? [];
    existing.push(handler);
    this.hooks.set(eventType, existing);
  }

  off(eventType: string, handler: HookHandler): void {
    const existing = this.hooks.get(eventType) ?? [];
    this.hooks.set(eventType, existing.filter(h => h !== handler));
  }

  // Emit an event and collect all effects to execute
  emit(game: GameState, event: GameEvent): Effect[] {
    const handlers = this.hooks.get(event.type) ?? [];
    const effects: Effect[] = [];
    for (const handler of handlers) {
      const result = handler(game, event);
      effects.push(...result);
    }
    return effects;
  }
}
