// src/engine/atoms/当作.ts
// 转化技包装:将 N 张手牌"转化"为指定牌(如将红牌当【杀】)。
// - 单张(武圣):1 张手牌 → 影子卡(suit/color 继承原卡,shadowOf=原卡)
// - 多张(丈八蛇矛):N 张手牌 → 1 张影子卡(suit='',颜色取综合:同色→该色/异色→无色,shadowOf 留空)
//
// shadowId 由调用方(技能)生成并传入,atom 零感知技能名。
// outputName 决定转化后的牌名。rollback(删影子/还原卡)由调用方技能回调负责,本 atom 不处理。
import type { AtomDefinition, Card, ViewEventSplit, ViewEvent } from '../types';
import type { Color } from '../../shared/types';
import { registerAtom } from '../atom';

/**
 * 转化后牌的颜色:
 * - 单张:继承原卡颜色
 * - 多张:全同色→该色;含异色→'无色'
 */
function transformColor(cardIds: string[], cardMap: Record<string, Card>): Color {
  if (cardIds.length === 1) return cardMap[cardIds[0]]?.color ?? '无色';
  let color: Color | undefined;
  for (const id of cardIds) {
    const c = cardMap[id]?.color;
    if (!c) return '无色';
    if (color === undefined) color = c;
    else if (color !== c) return '无色';
  }
  return color ?? '无色';
}

export const 当作: AtomDefinition<{
  player: number;
  cardIds: string[];
  shadowId: string;
  outputName: string;
}> = {
  type: '当作',
  validate(state, atom) {
    const self = state.players[atom.player];
    if (!self) return `player ${atom.player} not found`;
    if (!self.alive) return 'player not alive';
    const allInHand = atom.cardIds.every((id) => self.hand.includes(id));
    if (!allInHand) return 'cards not in hand';
    const allExist = atom.cardIds.every((id) => state.cardMap[id]);
    if (!allExist) return 'cards not found';
    return null;
  },
  apply(state, atom) {
    const self = state.players[atom.player];
    const firstCard = state.cardMap[atom.cardIds[0]];
    const single = atom.cardIds.length === 1;
    const shadow: Card = {
      id: atom.shadowId,
      name: atom.outputName,
      suit: single ? firstCard.suit : '',
      color: transformColor(atom.cardIds, state.cardMap),
      rank: firstCard.rank,
      type: '基本牌',
      shadowOf: single ? atom.cardIds[0] : undefined,
    };
    state.cardMap[atom.shadowId] = shadow;
    self.hand = self.hand.filter((c) => !atom.cardIds.includes(c));
    self.hand.push(atom.shadowId);
  },
  effect: { sound: 'transform', animation: 'flash', duration: 400 },
  toViewEvents(_state, atom): ViewEventSplit {
    const effect = { sound: 'transform' as const, animation: 'flash' as const, duration: 400 };
    const ownerView: ViewEvent = {
      type: '当作',
      player: atom.player,
      cardIds: atom.cardIds,
      shadowId: atom.shadowId,
      outputName: atom.outputName,
      effect,
    };
    const othersView: ViewEvent = {
      type: '当作',
      player: atom.player,
      count: atom.cardIds.length,
      effect,
    };
    return {
      ownerViews: new Map([[atom.player, ownerView]]),
      othersView,
    };
  },
  applyView(view, event) {
    const playerIdx = event.player as number;
    const pi = view.players.findIndex((p) => p.index === playerIdx);
    if (pi < 0) return;

    const ev = event as Record<string, unknown>;
    const cardIds = ev.cardIds as string[] | undefined;
    const shadowId = ev.shadowId as string | undefined;
    const count = (ev.count as number | undefined) ?? cardIds?.length ?? 1;
    const outputName = typeof ev.outputName === 'string' ? ev.outputName : '杀';

    view.players[pi].handCount = Math.max(0, view.players[pi].handCount - (count - 1));

    if (cardIds && shadowId && view.players[pi].hand) {
      let shadowCard = view.cardMap[shadowId];
      if (!shadowCard) {
        const origCard = view.cardMap[cardIds[0]];
        const single = count === 1;
        shadowCard = {
          id: shadowId,
          name: outputName,
          suit: single ? (origCard?.suit ?? '') : '',
          color: transformColor(cardIds, view.cardMap),
          rank: origCard?.rank ?? 'A',
          type: '基本牌',
          shadowOf: single ? cardIds[0] : undefined,
        };
        view.cardMap[shadowId] = shadowCard;
      }
      const idSet = new Set(cardIds);
      view.players[pi].hand = view.players[pi].hand.filter((c) => !idSet.has(c.id));
      view.players[pi].hand.push(shadowCard);
    }
  },
  toViewLog(event) {
    const ev = event as Record<string, unknown>;
    return {
      player: event.player as number,
      text: `使用转化出${typeof ev.outputName === 'string' ? ev.outputName : '牌'}`,
    };
  },
};

registerAtom(当作);
