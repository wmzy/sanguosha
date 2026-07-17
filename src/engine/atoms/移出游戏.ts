// src/engine/atoms/移出游戏.ts
// 移出游戏:界陆逊「界谦逊」专用——将指定手牌移出游戏(暂存于 player.vars['界谦逊/移出'])。
//
// 设计(与 置创牌 同构):
//   - 移出的牌不属于任何标准 zone(牌堆/弃牌堆/手牌/处理区),仅存于 player.vars['界谦逊/移出']
//     (cardId 列表,引擎权威)。buildView 不投影此字段。
//   - apply:从 player.hand 移除指定 cardIds,追加到 vars['界谦逊/移出']。
//   - toViewEvents:在 apply 之前调用,广播移出事件。信息分级——
//       owner 看到 cardIds(自身手牌已知,需精确从 view.hand 移除);
//       其他人只看到 count(hand 本就隐藏,仅同步 handCount)。
//   - applyView:owner 视角按 cardIds 精确移除 view.hand;所有人 handCount -= count。
//   - 归还由 归还移出牌 atom 处理(回合结束时由 界谦逊 hook 触发)。
//
// 触发时机:界谦逊 在延时锦囊/他人普通锦囊对陆逊生效且陆逊为唯一目标时,询问后调用本 atom。
// 注意:本 atom 会清空(或减少)手牌,可能触发「界连营」(失去所有手牌)。界连营通过
//   before-hook 记录移出前的手牌数、after-hook 判定手牌归零来联动。
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent, Card } from '../types';
import { registerAtom } from '../atom';

export const EXILE_VARS_KEY = '界谦逊/移出';

export const 移出游戏: AtomDefinition<{ player: number; cardIds: string[] }> = {
  type: '移出游戏',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (!Array.isArray(atom.cardIds) || atom.cardIds.length === 0) return `cardIds 不能为空`;
    const hand = state.players[atom.player].hand;
    for (const id of atom.cardIds) {
      if (!hand.includes(id)) return `card ${id} not in player ${atom.player} hand`;
    }
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const removeSet = new Set(atom.cardIds);
    player.hand = player.hand.filter((id) => !removeSet.has(id));
    const list = (player.vars[EXILE_VARS_KEY] as string[] | undefined) ?? [];
    for (const id of atom.cardIds) {
      if (!list.includes(id)) list.push(id);
    }
    player.vars[EXILE_VARS_KEY] = list;
  },
  effect: { sound: 'discard', animation: 'slide', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    const cards: Card[] = atom.cardIds
      .map((id) => state.cardMap[id])
      .filter((c): c is Card => !!c);
    const cardInfos = cards.map((c) => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank }));
    const ownerView: ViewEvent = {
      type: '移出游戏',
      player: atom.player,
      cardIds: atom.cardIds,
      cards: cardInfos,
    };
    const othersView: ViewEvent = {
      type: '移出游戏',
      player: atom.player,
      count: atom.cardIds.length,
    };
    return { ownerViews: new Map([[atom.player, ownerView]]), othersView };
  },
  applyView(view: GameView, event: ViewEvent) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    const cardIds = event.cardIds as string[] | undefined;
    const count = cardIds ? cardIds.length : ((event.count as number) ?? 0);
    view.players[pi].handCount = Math.max(0, view.players[pi].handCount - count);
    // owner 视角:view.hand 存在(自身手牌可见),按 cardId 精确移除
    if (cardIds && view.players[pi].hand) {
      const removeSet = new Set(cardIds);
      view.players[pi].hand = view.players[pi].hand.filter((c: Card) => !removeSet.has(c.id));
    }
  },
  toViewLog(event) {
    const count = ((event.cardIds as string[] | undefined)?.length) ?? (event.count as number) ?? 0;
    return { player: event.player as number, text: `谦逊:将 ${count} 张手牌移出游戏` };
  },
};

registerAtom(移出游戏);
