// 南蛮入侵(普通锦囊):出牌阶段,对所有其他角色使用。
// 每名目标依次判定:若不打出【杀】,则受到使用者造成的 1 点伤害。
//
// 询问杀 后检查处理区:有杀牌 = 出了杀;没有 = 受伤害。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '南蛮入侵', description: '对所有其他角色使用,每名目标需出杀,否则受 1 点伤害' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      const self = state.players[ownerId];
      if (!self?.hand.includes(params.cardId)) return '牌不在手牌中';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      pushFrame(state, '南蛮入侵', from, { ...params });

      // 从使用者下家开始,按座次顺序结算
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

      // 逐个询问杀,检查处理区判断是否出杀
      const notResponded: number[] = [];
      for (const target of targets) {
        await applyAtom(state, { type: '询问杀', target, source: from });
        // 检查处理区
        const killCardId = state.zones.processing.find(id => {
          const c = state.cardMap[id];
          return c && c.name === '杀';
        });
        if (killCardId) {
          // 出了杀:移到弃牌堆
          await applyAtom(state, {
            type: '移动牌',
            cardId: killCardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        } else {
          notResponded.push(target);
        }
      }

      // 对未出杀者造成伤害
      for (const target of notResponded) {
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
    label: '南蛮入侵',
    style: 'danger',
    prompt: {
      type: 'useCard',
      title: '南蛮入侵',
      cardFilter: { filter: (c) => c.name === '南蛮入侵', min: 1, max: 1 },
    },
  });
}

