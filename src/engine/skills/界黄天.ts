// 界黄天(界张角·主公技,OL 界限突破官方逐字):
//   主公技,其他群势力角色的出牌阶段限一次,其可以交给你一张【闪】或黑桃手牌。
//
// 界限突破(相对标黄天 src/engine/skills/黄天.ts):
//   标黄天:交一张【闪】或【闪电】。
//   界黄天:交一张【闪】或**黑桃手牌**(任意黑桃花色手牌,不限于闪电)。
//   (闪电本身是♠A,仍被接受;新增接受其他黑桃手牌如♠杀、♠决斗等。)
//
// 其余机制(use action 注册在每个群势力盟友座次上 / validate / execute)与标版一致。
//
// 命名:文件名/loader key/character skill name 均为 '界黄天';
//   内部 Skill.name = '黄天'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending } from '../skill';

const SKILL_ID = '界黄天';
const DISPLAY_NAME = '黄天';

/** 判断一张牌是否为界黄天可交的牌(闪或黑桃手牌) */
function isGiveableCard(state: GameState, cardId: string): boolean {
  const card = state.cardMap[cardId];
  if (!card) return false;
  return card.name === '闪' || card.suit === '♠';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '主公技:其他群势力角色可在出牌阶段将一张【闪】或黑桃手牌交给你',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 为每个群势力盟友(非界张角)注册 use action ──
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
        // 主公技:仅界张角为主公(ownerId===0)时可用
        if (ownerId !== 0) return '界黄天为主公技,界张角非主公';
        const lord = st.players[ownerId];
        if (!lord?.alive) return '主公不存在或已死亡';

        const self = st.players[allyIdx];
        if (!self?.alive) return '已死亡';
        // 自己回合 + 出牌阶段 + 无阻塞 pending
        const myTurn = st.currentPlayerIndex === allyIdx;
        const inActPhase = st.phase === '出牌';
        const free = !hasBlockingPending(st);
        if (!myTurn || !inActPhase || !free) return '现在不能使用界黄天';

        // 每回合限一次
        if (usedThisTurn(st, allyIdx, SKILL_ID)) return '本回合已使用过界黄天';

        // 牌校验:闪或黑桃手牌,且在手牌中
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张牌';
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        if (!isGiveableCard(st, cardId)) return '界黄天只能交出【闪】或黑桃手牌';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const cardId = params.cardId as string;
        // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
        await markOncePerTurn(st, allyIdx, SKILL_ID);
        // 移动牌:盟友手牌 → 界张角手牌
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

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  const ownerId = skill.ownerId;
  // 盟友的主动交牌 action。势力(群)与主公检查由后端 validate 处理
  // (GameView 不暴露 faction,activeWhen 仅做能力范围内的 UI 过滤)。
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '界黄天:交出一张【闪】或黑桃手牌给主公',
      cardFilter: {
        filter: (c) => c.name === '闪' || c.suit === '♠',
        min: 1,
        max: 1,
      },
    },
    activeWhen: (ctx) =>
      // 主公本人不应发动界黄天
      ctx.perspectiveIdx !== ownerId &&
      activeUnlessUsedThisTurn(SKILL_ID)(ctx) &&
      // 手中有可交的牌时才渲染
      ctx.view.players[ctx.perspectiveIdx]?.hand?.some(
        (c) => c.name === '闪' || c.suit === '♠',
      ) === true,
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
