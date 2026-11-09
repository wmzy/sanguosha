import type { FrontendAPI, GameState, Skill } from '../types';
import { registerSuppressionProvider } from '../core/skill-suppression';
import { isCharacterSkillId } from './registry';

const SKILL_ID = '缠怨';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description: '锁定技，你不能质疑蛊惑；体力值小于等于1时，你的其他技能失效',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  return registerSuppressionProvider(
    state,
    (current, ownerId, sourceSkillId) =>
      ownerId === skill.ownerId &&
      sourceSkillId !== SKILL_ID &&
      isCharacterSkillId(sourceSkillId) &&
      current.players[ownerId]?.skills.includes(SKILL_ID) === true &&
      current.players[ownerId].health <= 1,
    { includeLocked: true },
  );
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  return () => {};
}

export function isChanyuanSkillDisabled(state: GameState, ownerId: number): boolean {
  return state.players[ownerId]?.skills.includes(SKILL_ID) === true &&
    state.players[ownerId].health <= 1;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
