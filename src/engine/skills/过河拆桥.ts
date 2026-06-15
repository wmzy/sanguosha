// 过河拆桥(普通锦囊):
//   出牌阶段,对 1 名其他角色使用(无距离限制)。
//   弃置该角色区域内(手牌、装备区、判定区)的 1 张牌。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '过河拆桥', description: '锦囊:弃置目标一张牌' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'number') return 'target required';
      if (params.target === ownerId) return '不能对自己使用';
      const target = state.players[params.target];
      if (!target?.alive) return '目标不存在或已死亡';
      const hasCards = target.hand.length > 0 || Object.keys(target.equipment).length > 0;
      if (!hasCards) return '目标没有牌';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      pushFrame(state, '过河拆桥', from, { ...params });
      const cardId = params.cardId as string;
      const target = params.target as number;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 询问无懈可击
      delete state.localVars['无懈/被抵消'];
      await applyAtom(state, { type: '请求回应', requestType: '无懈可击', target: -2, prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } }, timeout: 10 });
      if (!state.localVars['无懈/被抵消']) {
      // 弃目标一张牌(简化:手牌第一张,无手牌则装备区第一槽)
      const targetPlayer = state.players[target];
      let discardCardId: string | undefined;
      if (targetPlayer && targetPlayer.hand.length > 0) {
        discardCardId = targetPlayer.hand[0];
      } else if (targetPlayer) {
        for (const slot of ['武器', '防具', '进攻马', '防御马', '宝物'] as const) {
          const id = targetPlayer.equipment?.[slot];
          if (id) { discardCardId = id; break; }
        }
      }
      if (discardCardId) {
        await applyAtom(state, { type: '弃置', player: target, cardIds: [discardCardId] });
      }
      }
      // 移锦囊到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '过河拆桥',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '过河拆桥',
      cardFilter: { filter: (c) => c.name === '过河拆桥', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
  });
}
