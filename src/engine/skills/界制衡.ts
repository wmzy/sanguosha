// 界制衡(界孙权·主动技):
//   出牌阶段限一次:你可以弃置任意张牌,然后摸等量张牌,
//   若你以此法弃置了所有手牌,你额外摸一张牌。
//
// OL 官方(hero/442)逐字:
//   "你可以弃置任意张牌,然后摸等量张牌,若你以此法弃置了所有手牌,你额外摸一张牌。"
//
// 与标制衡区别:
//   - 标版无"弃置所有手牌额外摸一张"奖励;界版有此奖励。
//   - "任意张牌"= 手牌+装备均可弃(标版引擎本就支持,界版沿用)。
//   - 独立界版技能文件,不修改标制衡。限一次标记键为 '界制衡'(与标制衡键隔离,互不影响)。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界制衡',
    description: '出牌阶段限一次:弃任意张牌(手牌/装备),摸等量张;若弃置了所有手牌,额外摸一张',
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
      // 兼容 cardIds 数组和单数 cardId(前端 handlePlayCard 发 cardId)
      const cardIds =
        (params.cardIds as string[] | undefined) ??
        (typeof params.cardId === 'string' ? [params.cardId] : undefined);
      if (!Array.isArray(cardIds) || cardIds.length === 0) return 'cardIds required (at least 1)';
      if (usedThisTurn(state, ownerId, '界制衡')) return '本回合已使用过界制衡';
      const self = state.players[ownerId];
      if (!self) return 'player not found';
      // 检查所有 cardId 在手牌或装备区中(手牌+装备均可弃)
      for (const cardId of cardIds) {
        const inHand = self.hand.includes(cardId);
        const inEquip = Object.values(self.equipment).includes(cardId);
        if (!inHand && !inEquip) return '牌不在手牌或装备区中';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      // [时序修复] 限一次标记必须在第一个 await 之前设置:dispatch 是 fire-and-forget,
      // session 不 await → execute 内的 await 会让出事件循环,前端可能在此期间
      // 再次点击技能按钮发 dispatch。若标记在末尾才设,第二次 validate 会通过 → 可重复发动。
      // markOncePerTurn 同步设 vars(防重入)+ 回合用量 atom 投影 view(前端据此禁用按钮)。
      await markOncePerTurn(state, ownerId, '界制衡');
      const from = ownerId;
      await pushFrame(state, '界制衡', from, { ...params });
      // 兼容 cardId 单数和 cardIds 数组,与 validate 中的逻辑一致
      const cardIds =
        (params.cardIds as string[] | undefined) ??
        (typeof params.cardId === 'string' ? [params.cardId] : []);

      // 判定"是否以此法弃置了所有手牌":必须在弃置前快照手牌(applyAtom 弃置会清空)。
      // 条件:弃置前手牌非空,且手牌中每一张都在本次弃置集合内。
      // (装备可一并弃,不影响判定——只要所有手牌都弃了即满足。)
      const handBefore = state.players[from].hand;
      const discardedAllHand =
        handBefore.length > 0 && handBefore.every((id) => cardIds.includes(id));

      // 弃置 N 张
      await applyAtom(state, { type: '弃置', player: from, cardIds });
      // 摸等量张;若弃置了所有手牌,额外多摸一张
      const drawCount = cardIds.length + (discardedAllHand ? 1 : 0);
      await applyAtom(state, { type: '摸牌', player: from, count: drawCount });
      await popFrame(state);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '界制衡',
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'select',
      title: '界制衡:选择要弃置的牌(手牌+装备均可;若弃置所有手牌,额外多摸一张)',
      source: 'handAndEquip',
      minTotal: 1,
      maxTotal: 99,
    },
    activeWhen: (ctx) => activeUnlessUsedThisTurn('界制衡')(ctx),
  });
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
