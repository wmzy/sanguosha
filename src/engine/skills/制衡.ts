// 制衡(孙权):
//   出牌阶段限一次:弃任意数量的牌(手牌或装备),然后摸等量的牌。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
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
      if (state.players[ownerId].vars['制衡/usedThisTurn']) return '本回合已使用过制衡';
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
      // [时序修复] 标记必须在第一个 await 之前设置:dispatch 是 fire-and-forget,
      // session 不 await → execute 内的 await applyAtom 会让出事件循环,前端可能在此期间
      // 再次点击技能按钮发 dispatch。若标记在 execute 末尾才设,第二次 validate 会通过 → 可重复发动。
      // 移到开头后,dispatch 同步阶段(启动 execute 前)就完成标记,第二次 validate 必然拒绝。
      state.players[ownerId].vars['制衡/usedThisTurn'] = true;
      // 同步限一次标记到 view:前端据此立即禁用制衡按钮。紧跟标记设置投影,
      // vars 已同步设(防 dispatch 重入),此处仅同步 view。
      await applyAtom(state, {
        type: '回合用量',
        player: ownerId,
        key: '制衡/usedThisTurn',
        value: true,
      });
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
    activeWhen: (ctx) =>
      defaultPlayActive(ctx) &&
      !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.['制衡/usedThisTurn'],
  });
  return () => {};
}
