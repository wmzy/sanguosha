import type { GameState, CharacterConfig, AbilityConfig } from '../../shared/types';
import { TriggerSystem, type GameEvent } from './trigger';
import type { Effect } from '../../shared/types';

// Register all passive skills from character configs into the trigger system
export function registerCharacterSkills(
  triggerSystem: TriggerSystem,
  characters: CharacterConfig[],
): void {
  for (const char of characters) {
    for (const ability of char.abilities) {
      if (ability.passive) {
        registerPassiveSkill(triggerSystem, char.name, ability);
      }
    }
  }
}

function registerPassiveSkill(
  triggerSystem: TriggerSystem,
  characterName: string,
  ability: AbilityConfig,
): void {
  const handler = (game: GameState, event: GameEvent): Effect[] => {
    // Only trigger for the correct player
    if (event.player !== characterName && event.target !== characterName) {
      return [];
    }

    // Check trigger type
    if (!matchesTrigger(ability.trigger, event.type)) {
      return [];
    }

    // Return the ability effect
    return [ability.effect];
  };

  // Register under the mapped GameEvent type so emit() can find the handler
  const eventType = triggerToEventType(ability.trigger);
  if (eventType) {
    triggerSystem.on(eventType, handler);
  }
}

function matchesTrigger(abilityTrigger: string, eventType: string): boolean {
  return triggerToEventType(abilityTrigger) === eventType;
}

function triggerToEventType(trigger: string): string | undefined {
  const mapping: Record<string, string> = {
    'onDamageReceived': 'damageReceived',
    'onDamageDealt': 'damageDealt',
    'onTurnStart': 'turnStart',
    'onTurnEnd': 'turnEnd',
    'onCardPlayed': 'cardPlayed',
    'onKill': 'death',
    'onDeath': 'death',
  };
  return mapping[trigger];
}
