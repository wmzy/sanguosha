// src/engine/skill-loader.ts
// 后续 PR 加 dynamic import + onInit/onMount 调度
import type { GameState, Skill } from './types';

export interface SkillInstance {
  skill: Skill;
  unload?: () => void;
}

export function getPlayerSkills(state: GameState, playerIndex: number): string[] {
  return state.players[playerIndex]?.skills ?? [];
}