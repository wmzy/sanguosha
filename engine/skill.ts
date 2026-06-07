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
/** 重置技能注册表（仅用于测试场景，确保 test 之间互相隔离） */
export function clearSkillRegistry(): void {
  registry.clear();
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
    // v3-only skill（无 trigger 字段）不进入 v2 state.triggers，
    // v2 emitEvent 不会调它。完整逻辑在 registerAtomHook 钩子中。
    if (!def.trigger) continue;
    newTriggers.push({
      event: def.trigger.event,
      source: '角色' as const,
      skillId: ability.name,
      player,
      priority: ability.passive ? 0 : 5,
      ...(def.trigger.optional ? { optional: true } : {}),
    });

    if (ability.modifiers) {
      for (const mod of ability.modifiers) {
        s = applyAtom(s, { type: '设置变量', player, key: mod, value: true });
      }
    }
  }

  return { ...s, triggers: [...s.triggers, ...newTriggers] };
}

export function registerEquipmentTriggers(
  state: GameState,
  player: string,
  cardId: string,
): GameState {
  const card = state.cardMap[cardId];
  if (!card) return state;

  // skill id === card.name（业务标识符中文化），直接用 card.name 查 registry。
  const def = registry.get(card.name);
  if (!def) return state;
  // v3-only 装备技能不进入 v2 state.triggers。
  if (!def.trigger) return state;

  const newTrigger: TriggerRule = {
    event: def.trigger.event,
    source: '装备',
    skillId: card.name,
    player,
    priority: 3,
    ...(def.trigger.optional ? { optional: true } : {}),
    ...(def.trigger.manual ? { manual: true } : {}),
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

  // skill id === card.name（业务标识符中文化）。
  return {
    ...state,
    triggers: state.triggers.filter(
      (t) => !(t.player === player && t.source === '装备' && t.skillId === card.name),
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
    // v3-only skill（无 trigger）不应出现在 state.triggers 中；
    // 此处 continue 是防御性兜底。
    if (!def.trigger) continue;

    if (event.type === '阶段开始') {
      const phaseEvent = event as { type: '阶段开始'; phase: string; player: string };
      if (trigger.player !== phaseEvent.player) continue;
    }
    // phase 字段对所有事件类型生效（修 §4.4）。
    // - phaseBegin / phaseEnd: 读 event.phase
    // - 其他事件（cardPlayed 等）: 读 state.phase（当前阶段）
    if (def.trigger.phase) {
      if (event.type === '阶段开始' || event.type === '阶段结束') {
        const eventPhase = (event as { phase: string }).phase;
        if (eventPhase !== def.trigger.phase) continue;
      } else {
        if (state.phase !== def.trigger.phase) continue;
      }
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
      type: '清空变量',
      player,
      pattern: CLEAR_TURN_PATTERN,
    });
  }
  return s;
}
