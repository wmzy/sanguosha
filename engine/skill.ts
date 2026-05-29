import type { GameState, CharacterConfig, AbilityConfig, Player } from '../shared/types';
import type { Rng } from '../shared/rng';
import { TriggerSystem, triggerToEventType } from './trigger';
import type { GameEvent, HookHandler, EffectExecContext, SkillAvailability } from './types';
import { getPlayer } from './state';
import { checkCondition } from './effect';

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
  const handler: HookHandler = (game: GameState, event: GameEvent) => {
    if (event.player !== characterName && event.target !== characterName) {
      return [];
    }

    const eventType = triggerToEventType(ability.trigger);
    if (eventType !== event.type) {
      return [];
    }

    if (ability.condition) {
      const player = getPlayer(game, characterName);
      if (!checkCondition(game, player, ability.condition, {
        player: characterName,
        target: event.target,
        attacker: event.attacker,
        card: event.card,
        amount: event.amount,
        rng: null as unknown as import('../shared/rng').Rng,
      })) {
        return [];
      }
    }

    return [ability.effect];
  };

  const eventType = triggerToEventType(ability.trigger);
  if (eventType) {
    triggerSystem.on(eventType, handler);
  }
}

export function getAvailableSkills(
  game: GameState,
  playerName: string,
): SkillAvailability[] {
  const player = getPlayer(game, playerName);
  if (!player.alive) return [];

  return player.character.abilities.map((ability, index) => {
    const canUse = !ability.passive && isSkillUsable(game, player, ability);
    return {
      name: ability.name,
      description: ability.description,
      index,
      canUse,
      targetRequired: ability.effect.type === 'giveCards',
      effect: ability.effect,
    };
  });
}

function isSkillUsable(game: GameState, player: Player, ability: AbilityConfig): boolean {
  if (ability.passive) return false;

  if (ability.condition?.phase && game.phase !== ability.condition.phase) return false;

  if (ability.condition?.hasHandCards && player.hand.length === 0) return false;

  if (ability.oncePerTurn) {
    if (game.skillsUsedThisTurn.includes(ability.name)) return false;
  }

  return true;
}

export interface SkillResult {
  success: boolean;
  state: GameState;
  message: string;
}

export function executeSkill(
  game: GameState,
  playerName: string,
  ability: AbilityConfig,
  _context: EffectExecContext,
  _rng: Rng,
): SkillResult {
  const player = getPlayer(game, playerName);
  if (!player.alive) {
    return { success: false, state: game, message: '玩家已死亡' };
  }

  if (ability.oncePerTurn && game.skillsUsedThisTurn.includes(ability.name)) {
    return { success: false, state: game, message: `${ability.name} 本回合已使用` };
  }

  return {
    success: true,
    state: game,
    message: `${playerName} 发动 ${ability.name}`,
  };
}

export { checkCondition };
