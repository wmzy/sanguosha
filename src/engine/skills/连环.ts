// 连环(庞统·主动技):你可以将一张梅花手牌当【铁索连环】使用或重铸。
//
// 分析:
//   类型:主动技(转化技/重铸) | 时机:出牌阶段
//
//   recycle(重铸):弃一张梅花手牌,摸一张牌。无次数限制。
//   transform(转化):preceding action,把梅花手牌通过「当作」atom 转化为影子「铁索连环」。
//     前端组合:preceding=[连环.transform] + 主 action=铁索连环.use。
//     铁索连环.use 零感知连环——它看到的是 cardMap 里的一张"铁索连环"。
//     模式参考 龙胆.ts / 武圣.ts。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, hasBlockingPending } from '../skill';
import { defaultPlayActive } from '../action-active';

/** 影子卡 id:${原id}#连环 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#连环`;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '连环',
    description: '你可以将一张梅花手牌当【铁索连环】使用或重铸',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── recycle:弃一张梅花手牌,摸一张牌(铁索连环的重铸效果)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'recycle',
    (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isClub = !!card && card.suit === '♣';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && isClub;
      return ok ? null : '现在不能重铸(需出牌阶段、手中梅花牌)';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      await pushFrame(state, '连环', from, { ...params });
      await applyAtom(state, { type: '弃置', player: from, cardIds: [cardId] });
      await applyAtom(state, { type: '摸牌', player: from, count: 1 });
      await popFrame(state);
    },
  );

  // ── transform:梅花手牌 → 影子"铁索连环"(作为 preceding,主 action=铁索连环.use) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isClub = !!card && card.suit === '♣';
      if (!selfAlive) return '你已死亡';
      if (!cardIdOk || !cardInHand) return '牌不在手牌中';
      if (!isClub) return '只能将梅花牌当铁索连环';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '铁索连环',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,手牌还原)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete state.cardMap[sId];
      const self = state.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('recycle', {
    label: '连环·重铸',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '连环:弃一张梅花手牌,摸一张牌',
      cardFilter: { filter: (c: Card) => c.suit === '♣', min: 1, max: 1 },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      const hasClub = p.hand?.some((c) => c.suit === '♣') ?? false;
      return hasClub;
    },
  });
  api.defineAction('transform', {
    label: '连环',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '连环:将一张梅花手牌当铁索连环使用',
      cardFilter: { filter: (c: Card) => c.suit === '♣', min: 1, max: 1 },
      targetFilter: { min: 1, max: 2 },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      return p.hand?.some((c) => c.suit === '♣') ?? false;
    },
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
