// src/engine/skill.ts
import type { BackendAPI, FrontendAPI, GameState, Skill } from './types';

export interface SkillModule {
  createSkill(id: string, ownerId: string): Skill;
  onInit?(skill: Skill, api: BackendAPI): () => void;
  onMount?(skill: Skill, api: FrontendAPI): () => void;
}

const modules = new Map<string, SkillModule>();

export function registerSkillModule(id: string, m: SkillModule): void {
  modules.set(id, m);
}

export function getSkillModule(id: string): SkillModule {
  const m = modules.get(id);
  if (!m) throw new Error(`Skill module "${id}" not registered`);
  return m;
}

export function clearSkillModules(): void {
  modules.clear();
}