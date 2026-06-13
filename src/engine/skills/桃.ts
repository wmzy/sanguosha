// src/engine/skills/桃.ts
// 桃:出牌阶段对自己使用(回复 1 体力);或濒死时对濒死角色使用
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '桃', description: '出牌阶段对自己使用,回复 1 体力(濒死时可对任何濒死角色使用)' };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const target = (params.target ?? (params.targets as string[] | undefined)?.[0]) as string | undefined;
      if (!target) return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const frame = pushFrame(state, '桃', from, { ...params });
      const cardId = params.cardId as string;
      const target = (params.target ?? (params.targets as string[] | undefined)?.[0]) as string;
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      await applyAtom(state, { type: '回复体力', target, amount: 1, source: from });
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
