// src/engine/skills/桃.ts
// 桃:出牌阶段对自己使用(回复 1 体力);或濒死时对濒死角色使用
import type { BackendAPI, GameView, Json, EngineApi, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '桃', description: '出牌阶段对自己使用,回复 1 体力(濒死时可对任何濒死角色使用)' };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (view: GameView, params: Record<string, Json>) => {
      const target = (params.target ?? (params.targets as string[] | undefined)?.[0]) as string | undefined;
      if (!target) return 'target required';
      return null;
    },
    async (api: EngineApi) => {
      const from = api.self;
      const params = api.params;
      const frame = api.pushFrame('桃', from, { ...params });
      const cardId = params.cardId as string;
      const target = (params.target ?? (params.targets as string[] | undefined)?.[0]) as string;
      await api.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      await api.apply({ type: '回复体力', target, amount: 1, source: from });
      await api.apply({
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    },
  );
  return () => {};
}

export const module_桃: SkillModule = { createSkill, onInit };
registerSkillModule('桃', module_桃);
