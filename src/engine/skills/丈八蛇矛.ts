// src/engine/skills/丈八蛇矛.ts
// 丈八蛇矛(武器):可将2张手牌当杀使用
import type { BackendAPI, FrontendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '丈八蛇矛', description: '武器:可将2张手牌当杀使用' };
}

export function onInit(_skill: Skill, _api: BackendAPI): () => void {
  // 后端不需要 registerAction,杀的 execute 处理 fromSkill='丈八蛇矛'
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('transform', {
    label: '丈八蛇矛',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择2张手牌当杀使用',
      cardFilter: { filter: () => true, min: 2, max: 2 },
    },
  });
  return () => {};
}

export const module_丈八蛇矛: SkillModule = { createSkill, onInit, onMount };
registerSkillModule('丈八蛇矛', module_丈八蛇矛);
