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
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 手牌 + 牌名 + 目标合法
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      // 每回合限一次
      const notUsed = !self?.vars['仁德/usedThisTurn'];
      const targets = params.targets as Array<{ target: number; cardIds: string[] }> | undefined;
      const hasTargets = Array.isArray(targets) && targets.length > 0;
      const total = hasTargets ? targets!.reduce((n, t) => n + (Array.isArray(t.cardIds) ? t.cardIds.length : 0), 0) : 0;
      const hasCards = total > 0;
      // 收集所有 cardId 检查重复 + 都在手牌
      const allCardIds: string[] = [];
      let noDuplicates = true;
      let allInHand = true;
      if (hasTargets) {
        for (const t of targets!) {
          if (!Array.isArray(t.cardIds)) { allInHand = false; continue; }
          for (const cardId of t.cardIds) {
            if (allCardIds.includes(cardId)) { noDuplicates = false; }
            allCardIds.push(cardId);
            if (!self?.hand.includes(cardId)) { allInHand = false; }
          }
        }
      }
      // 目标合法:不是自己 + 存活
      const targetsLegal = hasTargets && targets!.every(t => t.target !== ownerId && state.players[t.target]?.alive === true);
      const ok = myTurn && inActPhase && free && selfAlive && notUsed && hasTargets && hasCards && noDuplicates && allInHand && targetsLegal;
      return ok ? null : '现在不能使用仁德';
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

