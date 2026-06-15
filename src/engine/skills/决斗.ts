// 决斗(普通锦囊):出牌阶段,对一名其他角色使用。
// 目标先开始,与使用者轮流出杀,首先不出杀的一方受到对方造成的 1 点伤害。
//
// 询问杀 后检查处理区:有杀牌 = 出了杀;没有 = 没出(输)。
import type { GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '决斗', description: '对一名角色使用,双方轮流出杀,先不出者受 1 点伤害' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'number') return 'target required';
      const self = state.players[ownerId];
      if (!self?.hand.includes(params.cardId)) return '牌不在手牌中';
      if (params.target === ownerId) return '不能对自己使用';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as number;
      pushFrame(state, '决斗', from, { ...params });

      // 决斗锦囊进处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // 被无懈抵消则跳过效果
      delete state.localVars['无懈/被抵消'];
      await applyAtom(state, { type: '请求回应', requestType: '无懈可击', target: -2, prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } }, timeout: 10 });
      if (state.localVars['无懈/被抵消']) {
        // 决斗锦囊移出处理区→弃牌堆
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
        popFrame(state);
        return;
      }

      // 决斗循环:目标先出杀,之后发起者出杀,轮流。
      let turn = 0; // 0=目标, 1=发起者
      let loser: number | null = null;
      while (loser === null) {
        const current = turn === 0 ? target : from;
        await applyAtom(state, { type: '询问杀', target: current, source: turn === 0 ? from : target });
        // 检查处理区:有杀牌 = 出了杀,移走它;没有 = 没出,输
        const killCardId = state.zones.processing.find(id => {
          const c = state.cardMap[id];
          return c && c.name === '杀';
        });
        if (killCardId) {
          // 出了杀:移到弃牌堆,切换轮次
          await applyAtom(state, {
            type: '移动牌',
            cardId: killCardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
          turn = turn === 0 ? 1 : 0;
        } else {
          loser = current;
        }
      }
      const winner = loser === target ? from : target;
      await applyAtom(state, { type: '造成伤害', target: loser, amount: 1, source: winner, cardId });
      // 决斗锦囊移出处理区→弃牌堆
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      popFrame(state);
    },
  );
  return () => {};
}

