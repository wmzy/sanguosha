// src/engine/skills/青囊.ts
// 青囊(华佗·群雄):
//   出牌阶段限一次,你可以弃置一张手牌,然后令一名角色回复 1 点体力。
//
// 模型:主动 use action(模式 B,对标 制衡 的限一次 + 桃.use 的回复体力)。
//   - validate:自己回合 + 出牌阶段 + 本回合未用过 + 存活 +
//               弃置一张手牌(任意手牌)+ 目标存活且体力未满。
//   - execute:先同步置 usedThisTurn(防 dispatch 重入)→ 回合用量 atom 同步 view →
//               弃置 → 回复体力(amount=1)。
//   - 限一次:players[ownerId].vars['青囊/usedThisTurn'](后端) + turnUsage(前端)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '青囊',
    description: '出牌阶段限一次,弃一张手牌,令一名角色回复 1 点体力',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      // 出牌阶段基本条件
      if (state.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (state.phase !== '出牌') return '不是出牌阶段';
      if (state.players[ownerId].vars['青囊/usedThisTurn']) return '本回合已使用过青囊';
      const self = state.players[ownerId];
      if (!self) return 'player not found';
      if (!self.alive) return '你已死亡';
      // 弃置一张手牌(任意手牌)
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      // 目标:任意存活且体力未满的角色(含自己)
      const target =
        ((params.target ?? (params.targets as number[] | undefined)?.[0]) as number | undefined) ??
        ownerId;
      const tp = state.players[target];
      if (!tp) return '目标不存在';
      if (!tp.alive) return '目标已死亡';
      if (tp.health >= tp.maxHealth) return '目标体力已满';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = (
        (params.target ?? (params.targets as number[] | undefined)?.[0]) as number | undefined
      ) ?? ownerId;
      // [时序修复] 限一次标记必须在第一个 await 之前设置(防 dispatch 重入,见制衡.ts 注释)
      state.players[from].vars['青囊/usedThisTurn'] = true;
      // 同步限一次标记到 view:前端据此立即禁用青囊按钮
      await applyAtom(state, {
        type: '回合用量',
        player: from,
        key: '青囊/usedThisTurn',
        value: true,
      });
      await pushFrame(state, '青囊', from, { ...params });
      // 弃置一张手牌
      await applyAtom(state, { type: '弃置', player: from, cardIds: [cardId] });
      // 令目标回复 1 点体力
      await applyAtom(state, { type: '回复体力', target, amount: 1, source: from });
      await popFrame(state);
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '青囊',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '青囊：弃一张手牌,令一名角色回复 1 点体力',
      // 弃置任意手牌
      cardFilter: { min: 1, max: 1 },
      // 目标:存活且体力未满的角色(含自己)
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, target) => {
          const p = view.players[target];
          return !!p && p.alive !== false && p.health < p.maxHealth;
        },
      },
    },
    activeWhen: (ctx) =>
      defaultPlayActive(ctx) &&
      !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.['青囊/usedThisTurn'],
  });
  return;
}
