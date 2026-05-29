import type { GameState, Effect } from '../shared/types';
import type { GameEvent, HookHandler, EffectExecContext, EffectExecutor } from './types';

export type { GameEvent, HookHandler };

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

  emit(
    game: GameState,
    event: GameEvent,
    ctx: EffectExecContext,
    executor: EffectExecutor,
  ): GameState {
    const handlers = this.hooks.get(event.type) ?? [];
    let state = game;
    for (const handler of handlers) {
      const effects = handler(state, event);
      for (const effect of effects) {
        state = executor(state, effect, ctx);
      }
    }
    return state;
  }

  collectEffects(game: GameState, event: GameEvent): Effect[] {
    const handlers = this.hooks.get(event.type) ?? [];
    const effects: Effect[] = [];
    for (const handler of handlers) {
      effects.push(...handler(game, event));
    }
    return effects;
  }
}

const triggerToEventMap: Record<string, string> = {
  onDamageReceived: 'damageReceived',
  onDamageDealt: 'damageDealt',
  onTurnStart: 'turnStart',
  onTurnEnd: 'turnEnd',
  onCardPlayed: 'cardPlayed',
  onCardDrawn: 'cardDrawn',
  onKill: 'kill',
  onDeath: 'death',
  onHealReceived: 'healReceived',
  onJudge: 'judge',
  onTargeted: 'targeted',
  onHandEmpty: 'handEmpty',
  onEquipChange: 'equipChange',
};

export function triggerToEventType(trigger: string): string | undefined {
  return triggerToEventMap[trigger];
}
