// 借刀杀人(普通锦囊):
//   出牌阶段,对装备区有武器牌的 1 名其他角色(A)使用。
//   A 须选择:对使用者指定的另一名角色 B 使用 1 张杀,或交出武器。
//   请求回应 后检查处理区:有杀 = 出了杀;没有 = 不出(获得武器)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '借刀杀人', description: '锦囊:令目标出杀或获得其武器' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'number') return 'target required';
      if (typeof params.killTarget !== 'number') return 'killTarget required';
      const self = state.players[ownerId];
      if (!self?.hand.includes(params.cardId)) return '牌不在手牌中';
      const target = state.players[params.target];
      if (!target?.equipment?.['武器']) return '目标没有武器';
      if (params.target === ownerId) return '不能对自己使用';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as number;
      const killTarget = params.killTarget as number;
      pushFrame(state, '借刀杀人', from, { ...params });

      // 锦囊进处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });

      // 被无懈抵消则跳过效果
      delete state.localVars['无懈/被抵消'];
      await applyAtom(state, { type: '请求回应', requestType: '无懈可击', target: -2, prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } }, timeout: 10 });
      if (state.localVars['无懈/被抵消']) {
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        popFrame(state);
        return;
      }

      // 请求回应:目标选择出杀或交出武器
      await applyAtom(state, {
        type: '请求回应',
        requestType: '借刀杀人/forceKill',
        target,
        prompt: { type: 'confirm', title: '借刀杀人:是否出杀?', confirmLabel: '出杀', cancelLabel: '不出(失武器)' },
        defaultChoice: false,
        timeout: 15,
      });

      // 检查处理区:有杀 = 出了杀
      const killCardId = state.zones.processing.find(id => {
        const c = state.cardMap[id];
        return c && c.name === '杀';
      });

      if (killCardId) {
        // 目标出了杀:移到弃牌堆,执行杀的效果(对 killTarget 询问闪)
        await applyAtom(state, {
          type: '移动牌',
          cardId: killCardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
        await applyAtom(state, { type: '指定目标', source: target, target: killTarget, cardId: killCardId });
        await applyAtom(state, { type: '询问闪', target: killTarget, source: target });
        // 检查处理区:有闪 = 出了闪,没闪 = 伤害
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
      } else {
        // 不出杀:获得目标的武器
        const targetPlayer = state.players[target];
        const weaponId = targetPlayer?.equipment?.['武器'];
        if (weaponId) {
          await applyAtom(state, { type: '卸下', player: target, slot: '武器' });
          await applyAtom(state, { type: '获得', player: from, cardId: weaponId, from: target });
        }
      }

      // 锦囊移出处理区→弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '借刀杀人',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '借刀杀人',
      cardFilter: { filter: (c) => c.name === '借刀杀人', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
  });
}

