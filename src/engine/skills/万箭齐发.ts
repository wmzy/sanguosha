// 万箭齐发(普通锦囊):出牌阶段,对所有其他角色使用。
// 每名目标依次判定:若不打出【闪】,则受到使用者造成的 1 点伤害。
//
// 询问闪 后检查处理区:有闪牌 = 出了闪;没有 = 受伤害。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '万箭齐发', description: '对所有其他角色使用,每名目标需出闪,否则受 1 点伤害' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 手牌 + 牌名
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const cardInHand = cardIdOk && self?.hand.includes(cardId);
      const cardNameOk = cardIdOk && state.cardMap[cardId]?.name === '万箭齐发';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk;
      return ok ? null : '现在不能使用万箭齐发';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      pushFrame(state, '万箭齐发', from, { ...params });

      const targets = state.players.filter(p => p.index !== from && p.alive).map(p => p.index);

      // 锦囊进处理区
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
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
        popFrame(state);
        return;
      }

      // 逐个询问闪,检查处理区判断是否出闪
      const notDodged: number[] = [];
      for (const target of targets) {
        await applyAtom(state, { type: '询问闪', target, source: from });
        // 检查处理区
        const dodgeCardId = state.zones.processing.find(id => {
          const c = state.cardMap[id];
          return c && c.name === '闪';
        });
        if (dodgeCardId) {
          // 出了闪:移到弃牌堆
          await applyAtom(state, {
            type: '移动牌',
            cardId: dodgeCardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        } else {
          notDodged.push(target);
        }
      }

      // 对未闪避者造成伤害
      for (const target of notDodged) {
        await applyAtom(state, { type: '造成伤害', target, amount: 1, source: from, cardId });
      }

      // 锦囊移出处理区→弃牌堆
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

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '万箭齐发',
    style: 'danger',
    prompt: {
      type: 'useCard',
      title: '万箭齐发',
      cardFilter: { filter: (c) => c.name === '万箭齐发', min: 1, max: 1 },
    },
  });
}

