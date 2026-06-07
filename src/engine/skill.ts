import type {
  SkillDef,
  TriggerRule,
  GameState,
  GameEvent,
  EngineResult,
  ServerEvent,
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

export function getSkill(id: string, skillsMap?: Map<string, SkillDef>): SkillDef {
  const map = skillsMap ?? registry;
  const def = map.get(id);
  if (!def) throw new Error(`Unknown skill: "${id}"`);
  return def;
}

interface CharacterMapSource {
  characterMap: Record<string, CharacterConfig>;
}

/**
 * 注册角色触发器。
 *
 * 双源时期（[P5-T2] 过渡）：v2 老技能（trigger.event 走 GameEvent）仍需
 * state.triggers 推入才能被 emitEvent 触发，所以本函数保留 v2 push 行为。
 * v3 实装技能（registerHooks）走 createEngine 实例级 hookRegistry，
 * 不依赖本函数。
 *
 * 注意：PlayerState.skills 已在 createInitialState 从 characterMap 填好，
 * 本函数不重复设置 skills。但 modifiers 走 applyAtom setVar 会**重复
 * emit setVar serverLog 事件**——这是已知冗余，阶段 D 删 state.triggers
 * 字段后本函数将整个删除。
 */
export function registerCharacterTriggers(
  state: GameState,
  player: string,
  source: CharacterMapSource,
  skillsMap?: Map<string, SkillDef>,
): GameState {
  const map = skillsMap ?? registry;
  const characterId = state.players[player].info.characterId;
  const character = source.characterMap[characterId];
  if (!character) return state;

  // [P5-T3] 阶段 D：trigger 匹配已由 emitEvent 动态构建（从 PlayerState.skills），
  // 本函数只保留 modifiers（setVar）设置。trigger 不再写入 state.triggers。
  let s = state;
  for (const ability of character.abilities) {
    if (ability.modifiers) {
      for (const mod of ability.modifiers) {
        s = applyAtom(s, { type: '设置变量', player, key: mod, value: true });
      }
    }
  }
  return s;
}

/**
 * 装备技能触发器注册。
 *
 * [P5-T2] 双源时期：v2 装备技能（trigger.event）仍需 state.triggers 推入。
 * v3 实装装备技能（registerHooks）走 createEngine 实例级 hookRegistry。
 *
 * 阶段 D 删 state.triggers 后本函数将删除。
 */
// [P5-T3] 阶段 D：registerEquipmentTriggers / unregisterEquipmentTriggers
// 不再需要——emitEvent 动态从装备槽扫描 trigger。保留空函数签名避免调用点编译错误。
export function registerEquipmentTriggers(
  _state: GameState,
  _player: string,
  _cardId: string,
  _skillsMap?: Map<string, SkillDef>,
): GameState {
  return _state;
}

export function unregisterEquipmentTriggers(
  state: GameState,
  _player: string,
  _cardId: string,
): GameState {
  return state;
}

/**
 * 派发 GameEvent 给所有匹配的 v2 trigger 技能。
 *
 * [P5-T3] 阶段 D 重写：不再读 state.triggers 字段，
 * 改为运行时从 state.players[P].skills + 装备槽动态构建 trigger 列表。
 * 消除了对 state.triggers / registerCharacterTriggers / registerEquipmentTriggers 的依赖。
 */
export function emitEvent(
  state: GameState,
  event: GameEvent,
  skillsMap?: Map<string, SkillDef>,
): EngineResult {
  const map = skillsMap ?? registry;

  // 动态构建 trigger 列表：遍历所有玩家 → skills（角色）+ equipment（装备）
  const matched: TriggerRule[] = [];
  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    if (!player) continue;

    // 角色技能
    for (const skillId of player.skills) {
      const def = map.get(skillId);
      if (!def?.trigger) continue;
      if (def.trigger.event !== event.type) continue;
      matched.push({
        event: def.trigger.event,
        source: '角色',
        skillId,
        player: playerId,
        priority: 5,
        ...(def.trigger.optional ? { optional: true } : {}),
      });
    }

    // 装备技能
    for (const slot of Object.values(player.equipment) as string[]) {
      if (!slot) continue;
      const card = state.cardMap[slot];
      if (!card) continue;
      const def = map.get(card.name);
      if (!def?.trigger) continue;
      if (def.trigger.event !== event.type) continue;
      matched.push({
        event: def.trigger.event,
        source: '装备',
        skillId: card.name,
        player: playerId,
        priority: 3,
        ...(def.trigger.optional ? { optional: true } : {}),
      });
    }
  }

  // 按 priority 降序排序（高优先级先执行）
  matched.sort((a, b) => b.priority - a.priority);

  let s = state;
  const allEvents: ServerEvent[] = [];

  for (const trigger of matched) {
    const def = map.get(trigger.skillId);
    if (!def) continue;
    if (!def.trigger) continue;

    if (event.type === '阶段开始') {
      const phaseEvent = event as { type: '阶段开始'; phase: string; player: string };
      if (trigger.player !== phaseEvent.player) continue;
    }
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
