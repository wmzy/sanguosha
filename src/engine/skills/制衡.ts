// 制衡(孙权):
//   出牌阶段限一次:弃任意数量的牌(手牌或装备),然后摸等量的牌。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '制衡',
    description: '出牌阶段限一次:弃任意张牌(手牌/装备),摸等量的牌',
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
      if (usedThisTurn(state, ownerId, '制衡')) return '本回合已使用过制衡';
      const self = state.players[ownerId];
      if (!self) return 'player not found';
      // 检查所有 cardId 在手牌或装备区中
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
      await markOncePerTurn(state, ownerId, '制衡');
      const from = ownerId;
      await pushFrame(state, '制衡', from, { ...params });
      // 兼容 cardId 单数和 cardIds 数组,与 validate 中的逻辑一致
      const cardIds =
        (params.cardIds as string[] | undefined) ??
        (typeof params.cardId === 'string' ? [params.cardId] : []);
      // 弃置 N 张
      await applyAtom(state, { type: '弃置', player: from, cardIds });
      // 摸 N 张
      await applyAtom(state, { type: '摸牌', player: from, count: cardIds.length });
      await popFrame(state);
      // execute 抛错时标记已设但效果未完成——这是可接受的:限一次本就防止重复,
      // 且 execute 内部 applyAtom 失败会静默 return(validate 拒绝),不会部分执行。
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '制衡',
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'select',
      title: '制衡：选择要弃置的牌（可多选）',
      source: 'handAndEquip',
      minTotal: 1,
      maxTotal: 99,
    },
    activeWhen: (ctx) => activeUnlessUsedThisTurn('制衡')(ctx),
  });
  return () => {};
}
