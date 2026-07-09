// 黄天(张角·主公技):其他群势力角色可以在其出牌阶段将一张【闪】或【闪电】交给你。
//   每名角色每回合限一次。
//
// 模式 B 变体(主公技):在张角(ownerId)实例上注册,但 use action 注册在
//   每个群势力盟友座次上(非张角本人),盟友在自己出牌阶段主动交牌。
//   参考护驾(为魏势力盟友注册 respond action)的同构模式。
//
// 流程:
//   1. 群势力盟友在自己回合出牌阶段 dispatch 黄天.use(选一张闪/闪电)
//   2. validate:盟友回合+出牌阶段+无pending+存活+张角为主公+张角存活+牌为闪/闪电且在手+本回合未用
//   3. execute:移动牌(盟友手牌→张角手牌)+ 标记本回合已用
//
// 主公判定:ownerId === 0(参考激将/若愚的主公判定约定)。
// 限一次:player.vars['黄天/usedThisTurn'](后缀约定,回合结束 atom 自动清空)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending } from '../skill';

/** 判断一张牌是否为黄天可交的牌(闪或闪电) */
function isGiveableCard(state: GameState, cardId: string): boolean {
  const name = state.cardMap[cardId]?.name;
  return name === '闪' || name === '闪电';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '黄天',
    description: '主公技:其他群势力角色可在出牌阶段将一张【闪】或【闪电】交给你',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 为每个群势力盟友(非张角)注册 use action ──
  for (const p of state.players) {
    const allyIdx = p.index;
    if (allyIdx === ownerId) continue;
    if (p.faction !== '群') continue;

    registerAction(
      state,
      skill.id,
      allyIdx,
      'use',
      (st: GameState, params: Record<string, Json>): string | null => {
        // 主公技:仅张角为主公(ownerId===0)时可用
        if (ownerId !== 0) return '黄天为主公技,张角非主公';
        const lord = st.players[ownerId];
        if (!lord?.alive) return '主公不存在或已死亡';

        const self = st.players[allyIdx];
        if (!self?.alive) return '已死亡';
        // 自己回合 + 出牌阶段 + 无阻塞 pending
        const myTurn = st.currentPlayerIndex === allyIdx;
        const inActPhase = st.phase === '出牌';
        const free = !hasBlockingPending(st);
        if (!myTurn || !inActPhase || !free) return '现在不能使用黄天';

        // 每回合限一次
        if (usedThisTurn(st, allyIdx, '黄天')) return '本回合已使用过黄天';

        // 牌校验:闪或闪电,且在手牌中
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张牌';
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        if (!isGiveableCard(st, cardId)) return '黄天只能交出【闪】或【闪电】';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const cardId = params.cardId as string;
        // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
        await markOncePerTurn(st, allyIdx, '黄天');
        // 移动牌:盟友手牌 → 张角手牌
        await applyAtom(st, {
          type: '移动牌',
          cardId,
          from: { zone: '手牌', player: allyIdx },
          to: { zone: '手牌', player: ownerId },
        });
      },
    );
  }

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 盟友的主动交牌 action。势力(群)与主公检查由后端 validate 处理
  // (GameView 不暴露 faction,activeWhen 仅做能力范围内的 UI 过滤)。
  api.defineAction('use', {
    label: '黄天',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '黄天:交出一张【闪】或【闪电】给主公',
      cardFilter: {
        filter: (c) => c.name === '闪' || c.name === '闪电',
        min: 1,
        max: 1,
      },
    },
    activeWhen: (ctx) =>
      activeUnlessUsedThisTurn('黄天')(ctx) &&
      // 手中有可交的牌时才渲染
      ctx.view.players[ctx.perspectiveIdx]?.hand?.some(
        (c) => c.name === '闪' || c.name === '闪电',
      ) === true,
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
