// engine/skills/观星.ts
import type { SkillDef } from '../types';

export const def: SkillDef =   {
    id: '观星',
    name: '观星',
    description: '准备阶段，你可以观看牌堆顶的X张牌（X为存活角色数且至多为5），并将任意数量的牌以任意顺序置于牌堆顶，其余以任意顺序置于牌堆底。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '准备',
      optional: true,
    },
    handler(_ctx, _state) {
      const aliveCount = _state.playerOrder.filter(n => _state.players[n].info.alive).length;
      const N = Math.min(aliveCount, 5);
      const topCards = _state.zones.deck.slice(0, N);
      if (topCards.length === 0) return [];
      return buildRearrangeTree(_state, topCards, 0, [], [], _ctx.self);
    },
  };

/** 递归构建观星的 prompt + condition 决策树 */
function buildRearrangeTree(
  state: GameState,
  cards: string[],
  index: number,
  topSoFar: string[],
  bottomSoFar: string[],
  player: string,
): SkillPhase[] {
  if (index >= cards.length) {
    return [{
      type: 'atoms',
      ops: [{
        type: '整理牌堆' as const,
        player,
        topCardIds: topSoFar,
        bottomCardIds: bottomSoFar,
      }],
    }];
  }

  const card = state.cardMap[cards[index]];
  const label = `${card.suit}${card.rank} ${card.name}`;

  return [
    {
      type: 'prompt',
      text: `观星：${label}（第${index + 1}/${cards.length}张）放到`,
      options: [
        { label: '牌堆顶', value: 'top' },
        { label: '牌堆底', value: 'bottom' },
      ],
    },
    {
      type: 'condition',
      check: { equals: [{ $: 'ctx', path: 'choice' }, 'top'] },
      then: buildRearrangeTree(state, cards, index + 1, [...topSoFar, cards[index]], bottomSoFar, player),
      else: buildRearrangeTree(state, cards, index + 1, topSoFar, [...bottomSoFar, cards[index]], player),
    },
  ];
}
