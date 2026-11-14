// 制衡(孙权):
//   出牌阶段限一次:弃任意数量的牌(手牌或装备),然后摸等量的牌。
//
// 本文件同时导出 createZhihengSkill 工厂:标版/界制衡约 85% 逐字相同,真实差异仅
// "弃完所有手牌额外摸一张"(界版注入 bonusDrawWhenAllHandDiscarded)。
// 标版的 cardIds 去重校验经 rejectDuplicateCardIds 注入(界版历史现状无此校验,
// 为行为等价保留差异)。参照 八阵.ts 复用 八卦阵.ts 工厂的做法,界制衡.ts 声明式消费。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../rules/once-per-turn';
import { registerAction } from '../core/skill';
import { normalizeCardIds } from '../util/skillRuntime';

/** createZhihengSkill 可注入差异。 */
export interface ZhihengOptions {
  name: string;
  description: string;
  /** onMount 选牌面板标题(两版文案不同,逐字保留)。 */
  mountTitle: string;
  /** 弃置了所有手牌时额外摸一张(界版官方奖励;标版缺省不奖励)。 */
  bonusDrawWhenAllHandDiscarded?: boolean;
  /** cardIds 去重校验:重复 id 会绕过 includes 检查,使同一张牌被弃置两次(弃牌堆重复)。
   *  标版有、界版历史现状无,为行为等价按版本注入。 */
  rejectDuplicateCardIds?: boolean;
}

/** 制衡族(制衡/界制衡)技能工厂:出牌阶段限一次,弃任意张牌(手牌/装备)摸等量张。 */
export function createZhihengSkill(opts: ZhihengOptions) {
  function createSkill(id: string, ownerId: number): Skill {
    return { id, ownerId, name: opts.name, description: opts.description };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (state: GameState, params: Record<string, Json>) => {
        // 兼容 cardIds 数组和单数 cardId(前端 handlePlayCard 发 cardId)
        const cardIds = normalizeCardIds(params);
        if (cardIds.length === 0) return 'cardIds required (at least 1)';
        if (opts.rejectDuplicateCardIds && new Set(cardIds).size !== cardIds.length)
          return 'cardIds 含重复牌';
        if (usedThisTurn(state, ownerId, opts.name)) return `本回合已使用过${opts.name}`;
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
        await markOncePerTurn(state, ownerId, opts.name);
        const from = ownerId;
        await pushFrame(state, opts.name, from, { ...params });
        const cardIds = normalizeCardIds(params);
        // 判定"是否以此法弃置了所有手牌":必须在弃置前快照手牌(applyAtom 弃置会清空)。
        // 条件:弃置前手牌非空,且手牌中每一张都在本次弃置集合内。
        // (装备可一并弃,不影响判定——只要所有手牌都弃了即满足。)
        const handBefore = state.players[from].hand;
        const discardedAllHand =
          handBefore.length > 0 && handBefore.every((id) => cardIds.includes(id));
        // 弃置 N 张
        await applyAtom(state, { type: '弃置', player: from, cardIds, voluntary: true });
        // 摸等量张;界版若弃置了所有手牌,额外多摸一张
        const drawCount =
          cardIds.length + (opts.bonusDrawWhenAllHandDiscarded && discardedAllHand ? 1 : 0);
        await applyAtom(state, { type: '摸牌', player: from, count: drawCount });
        await popFrame(state);
        // execute 抛错时标记已设但效果未完成——这是可接受的:限一次本就防止重复,
        // 且 execute 内部 applyAtom 失败会静默 return(validate 拒绝),不会部分执行。
      },
    );
    return () => {};
  }

  function onMount(skill: Skill, api: FrontendAPI): () => void {
    api.defineAction('use', {
      label: opts.name,
      style: 'primary',
      prompt: {
        type: 'distribute',
        mode: 'select',
        title: opts.mountTitle,
        source: 'handAndEquip',
        minTotal: 1,
        maxTotal: 99,
      },
      activeWhen: (ctx) => activeUnlessUsedThisTurn(opts.name)(ctx),
    });
    return () => {};
  }

  return { createSkill, onInit, onMount };
}

export const { createSkill, onInit, onMount } = createZhihengSkill({
  name: '制衡',
  description: '出牌阶段限一次:弃任意张牌(手牌/装备),摸等量的牌',
  mountTitle: '制衡：选择要弃置的牌（可多选）',
  rejectDuplicateCardIds: true,
});
