import type {
  SkillDef,
  TriggerRule,
  GameState,
  GameEvent,
  EngineResult,
} from './types';
import type { CharacterConfig } from '../shared/types';
import { checkCondition } from './expr';
import { executePlan } from './phase';
import { buildSkillContext } from './context';
import { getAlivePlayerNames } from './state';
import { applyAtom } from './atom';

const registry = new Map<string, SkillDef>();

export function registerSkill(def: SkillDef): void {
  if (registry.has(def.id)) {
    throw new Error(`Skill "${def.id}" already registered`);
  }
  registry.set(def.id, def);
}

export function getSkillRegistry(): Map<string, SkillDef> {
  return registry;
}

export function getSkill(id: string): SkillDef {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown skill: "${id}"`);
  return def;
}

interface CharacterMapSource {
  characterMap: Record<string, CharacterConfig>;
}

export function registerCharacterTriggers(
  state: GameState,
  player: string,
  source: CharacterMapSource,
): GameState {
  const characterId = state.players[player].info.characterId;
  const character = source.characterMap[characterId];
  if (!character) return state;

  const newTriggers: TriggerRule[] = [];
  let s = state;

  for (const ability of character.abilities) {
    const def = registry.get(ability.name);
    if (!def) continue;
    newTriggers.push({
      event: def.trigger.event,
      source: 'character' as const,
      skillId: ability.name,
      player,
      priority: ability.passive ? 0 : 5,
    });

    if (ability.modifiers) {
      for (const mod of ability.modifiers) {
        s = applyAtom(s, { type: 'setVar', player, key: mod, value: true });
      }
    }
  }

  return { ...s, triggers: [...s.triggers, ...newTriggers] };
}

const EQUIPMENT_SKILL_MAP: Record<string, string> = {
  诸葛连弩: 'unlimitedKills',
  八卦阵: 'judgeDodge',
  仁王盾: 'blockBlackKill',
  青龙偃月刀: 'chaseDodge',
  丈八蛇矛: 'dualWeapon',
  青釭剑: 'ignoreArmor',
  贯石斧: 'forceHit',
};

export function registerEquipmentTriggers(
  state: GameState,
  player: string,
  cardId: string,
): GameState {
  const card = state.cardMap[cardId];
  if (!card) return state;

  const skillId = EQUIPMENT_SKILL_MAP[card.name];
  if (!skillId) return state;

  const newTrigger: TriggerRule = {
    event: 'killResponse',
    source: 'equipment',
    skillId,
    player,
    priority: 3,
  };

  return { ...state, triggers: [...state.triggers, newTrigger] };
}

export function unregisterEquipmentTriggers(
  state: GameState,
  player: string,
  cardId: string,
): GameState {
  const card = state.cardMap[cardId];
  if (!card) return state;

  const skillId = EQUIPMENT_SKILL_MAP[card.name];
  if (!skillId) return state;

  return {
    ...state,
    triggers: state.triggers.filter(
      (t) => !(t.player === player && t.source === 'equipment' && t.skillId === skillId),
    ),
  };
}

export function emitEvent(
  state: GameState,
  event: GameEvent,
): EngineResult {
  const matched = state.triggers
    .filter((t) => t.event === event.type)
    .filter((t) => {
      if (!t.filter) return true;
      return checkCondition(t.filter, state);
    })
    .sort((a, b) => b.priority - a.priority);

  let s = state;
  const allEvents: import('./types').ServerEvent[] = [];

  for (const trigger of matched) {
    const def = registry.get(trigger.skillId);
    if (!def) continue;

    if (event.type === 'phaseBegin') {
      const phaseEvent = event as { type: 'phaseBegin'; phase: string; player: string };
      if (trigger.player !== phaseEvent.player) continue;
      if (def.trigger.phase && phaseEvent.phase !== def.trigger.phase) continue;
    }

    const ctx = buildSkillContext(s, event, trigger);
    const phases = def.handler(ctx, s);

    if (phases.length === 0) continue;

    const result = executePlan(s, phases, ctx);
    s = result.state;
    allEvents.push(...result.events);

    if (s.pending !== null) {
      return { state: s, events: allEvents };
    }
  }

  return { state: s, events: allEvents };
}

const CLEAR_TURN_PATTERN = '*/usedThisTurn';

export function clearTurnVars(state: GameState): GameState {
  let s = state;
  for (const player of getAlivePlayerNames(s)) {
    s = applyAtom(s, {
      type: 'clearVarPattern',
      player,
      pattern: CLEAR_TURN_PATTERN,
    });
  }
  return s;
}
