// 仁德(刘备):
//   出牌阶段,可以将任意数量手牌给其他角色;给出 ≥2 张后回复 1 体力。每回合限一次。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '仁德',
    description: '出牌阶段限一次:将手牌给其他角色;给出 ≥2 张后回复 1 体力',
  };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      const targets = params.targets as Array<{ target: number; cardIds: string[] }> | undefined;
      if (!Array.isArray(targets) || targets.length === 0) return 'targets required';
      const total = targets.reduce((n, t) => n + (Array.isArray(t.cardIds) ? t.cardIds.length : 0), 0);
      if (total === 0) return 'no cards to give';
      // 每回合限一次
      if (state.players[ownerId]?.vars['仁德/usedThisTurn']) return '本回合已使用过仁德';
      // 检查所有 cardId 在手牌中,target 不是自己
      const self = state.players[ownerId];
      for (const t of targets) {
        if (t.target === ownerId) return '不能给自己';
        if (!state.players[t.target]?.alive) return '目标不存在或已死亡';
        for (const cardId of t.cardIds) {
          if (!self.hand.includes(cardId)) return '牌不在手牌中';
        }
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      pushFrame(state, '仁德', from, { ...params });
      const targets = params.targets as Array<{ target: number; cardIds: string[] }>;
      for (const t of targets) {
        for (const cardId of t.cardIds) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '手牌', player: t.target } });
        }
      }
      const total = targets.reduce((n, t) => n + t.cardIds.length, 0);
      if (total >= 2 && !state.players[from].vars['仁德/healedThisTurn']) {
        await applyAtom(state, { type: '回复体力', target: from, amount: 1 });
        state.players[from].vars['仁德/healedThisTurn'] = true;
      }
      state.players[from].vars['仁德/usedThisTurn'] = true;
      popFrame(state);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '仁德',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '仁德：选择要送出的手牌和目标角色',
      cardFilter: { min: 1, max: 99 },
      targetFilter: { min: 1, max: 1 },
    },
  });
  return () => {};
}

