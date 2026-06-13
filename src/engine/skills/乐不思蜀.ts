// src/engine/skills/乐不思蜀.ts
// 乐不思蜀(延时锦囊):对一名角色使用,判定结果为红桃则跳过出牌阶段
import type { GameState, AtomAfterContext, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '乐不思蜀', description: '延时锦囊:判定红桃则跳过出牌阶段' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'string') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as string;
      pushFrame(state, '乐不思蜀', from, { ...params });
      // 移牌到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 添加延时锦囊到目标
      const trickCard = state.cardMap[cardId];
      await applyAtom(state, { type: '添加延时锦囊', player: target, trick: { name: '乐不思蜀', source: from, card: trickCard ?? { id: cardId, name: '乐不思蜀', suit: '', type: '锦囊牌' } } });
      // 移牌到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  // 判定后检查结果:红桃则标记跳过出牌
  registerAfterHook(_skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    // 简化:通过 ctx.params.__乐不思蜀判定 标记
    // 判定 atom 的结果存在 state.localVars 或 frame.params 中
    // 实际需要检查判定牌花色,此处用占位逻辑
  });
  return () => {};
}

export default { createSkill, onInit };
