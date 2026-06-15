// 激将(刘备·主公技):
//   出牌阶段,主公可请求一名蜀势力角色出杀。
//   该角色选择出杀或不出(不出则主公摸 1 张)。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '激将',
    description: '主公技:请求一名蜀势力角色出杀,不出则摸 1 张',
  };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      if (typeof params.target !== 'number') return 'target required';
      const target = state.players[params.target];
      if (!target?.alive) return '目标不存在或已死亡';
      if (params.target === ownerId) return '不能激将自己';
      if (target.faction !== '蜀') return '只能激将蜀势力角色';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;
      const killTarget = params.killTarget as number | undefined;
      pushFrame(state, '激将', from, { ...params });

      // 请求回应:目标选择出杀
      await applyAtom(state, {
        type: '请求回应',
        requestType: '激将/respondKill',
        target,
        prompt: { type: 'confirm', title: '主公激将:是否出杀?' },
        timeout: 15,
      });

      // 检查处理区:有杀 = 出了杀
      const killCardId = state.zones.processing.find(id => {
        const c = state.cardMap[id];
        return c && c.name === '杀';
      });

      if (killCardId) {
        // 出了杀:移到弃牌堆,执行杀效果
        await applyAtom(state, {
          type: '移动牌',
          cardId: killCardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
        if (typeof killTarget === 'number') {
          await applyAtom(state, { type: '指定目标', source: target, target: killTarget, cardId: killCardId });
          await applyAtom(state, { type: '询问闪', target: killTarget, source: target });
          const dodgeCardId = state.zones.processing.find(id => {
            const c = state.cardMap[id];
            return c && c.name === '闪';
          });
          if (dodgeCardId) {
            await applyAtom(state, {
              type: '移动牌',
              cardId: dodgeCardId,
              from: { zone: '处理区' },
              to: { zone: '弃牌堆' },
            });
          } else {
            await applyAtom(state, { type: '造成伤害', target: killTarget, amount: 1, source: target, cardId: killCardId });
          }
        }
      } else {
        // 不出:主公摸 1 张
        await applyAtom(state, { type: '摸牌', player: from, count: 1 });
      }
      popFrame(state);
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '激将',
    style: 'primary',
    prompt: {
      type: 'choosePlayer',
      title: '激将：选择一名蜀势力角色出杀',
      min: 1,
      max: 1,
    },
  });
  return () => {};
}

