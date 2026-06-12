// @ts-nocheck
// engine/skill.ts — 技能注册表 + 辅助函数
//
// v2 清理后保留：
// - 全局 registry (registerSkill / getSkillRegistry) — 供 skills/index.ts 注册
// - getSkill()：从 skillsMap 查 SkillDef
// - clearTurnVars()：回合结束清理
//
// 已删除（v2 清理）：
// - emitEvent() — v2 GameEvent 派发管道
// - registerCharacterTriggers() / registerEquipmentTriggers() / unregisterEquipmentTriggers()
// - TriggerRule / TriggerSpec — 不再写入 state.triggers

import type {
  SkillDef,
  GameState,
} from './types';

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

/**
 * 清空全局 skill registry。
 */
export function clearSkillRegistry(): void {
  registry.clear();
}

/**
 * 从 skillsMap 查找 SkillDef。
 */
export function getSkill(id: string, skillsMap?: Map<string, SkillDef>): SkillDef {
  const map = skillsMap;
  if (map) {
    const def = map.get(id);
    if (def) return def;
  }
  throw new Error(`Skill "${id}" not found`);
}

/** 回合结束清理：移除所有 usedThisTurn 标记的 vars/tag */
export function clearTurnVars(state: GameState): GameState {
  let s = state;
  for (const pid of s.playerOrder) {
    const p = s.players[pid];
    if (!p) continue;
    const vars = { ...p.vars };
    let changed = false;
    for (const key of Object.keys(vars)) {
      if (key.endsWith('/usedThisTurn')) {
        delete vars[key];
        changed = true;
      }
    }
    if (changed) {
      s = {
        ...s,
        players: { ...s.players, [pid]: { ...p, vars } },
      };
    }
  }
  return s;
}
