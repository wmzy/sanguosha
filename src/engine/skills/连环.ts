// 连环(庞统·主动技):你可以将一张梅花手牌当【铁索连环】使用或重铸。
//
// 分析(步骤1):
//   类型:主动技(转化技/重铸) | 时机:出牌阶段
//   约束:【铁索连环】卡牌/技能尚未实现(skillLoaders 无 '铁索连环',文件不存在)。
//     故本次只实现【重铸】(弃一张梅花手牌,摸一张牌);
//     转化为铁索连环【使用】部分待铁索连环技能实现后补充(见文末 TODO)。
//
//   重铸(recycle action):
//     validate: 自己回合 + 出牌阶段 + 无阻塞 pending + 存活 + 手牌中有梅花牌
//     execute:  pushFrame → 弃置该梅花牌 → 摸1张 → popFrame
//   无次数限制(铁索连环重铸不限次)。
//   契约:无跨 atom 通信。
//
// TODO(铁索连环使用部分):铁索连环技能实现后,新增 'transform' action:
//   把梅花手牌通过「当作」atom 转化为影子「铁索连环」,preceding=[连环.transform] + 主 action=铁索连环.use。
//   模式参考 武圣.ts / 龙胆.ts。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, hasBlockingPending } from '../skill';
import { defaultPlayActive } from '../action-active';

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
      // 弃掉梅花牌
      await applyAtom(state, { type: '弃置', player: from, cardIds: [cardId] });
      // 摸一张牌
      await applyAtom(state, { type: '摸牌', player: from, count: 1 });
      await popFrame(state);
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
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
