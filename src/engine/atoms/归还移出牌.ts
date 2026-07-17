// src/engine/atoms/归还移出牌.ts
// 归还移出牌:界陆逊「界谦逊」专用——回合结束时,将此前移出游戏的手牌归还其手牌。
//
// 设计(与 置创牌 的逆操作对称):
//   - 移出的牌存于 player.vars['界谦逊/移出'](cardId 列表,引擎权威),非标准 zone。
//   - apply:把 vars['界谦逊/移出'] 中的全部 cardId 追加回 player.hand,并清空该 vars 键。
//     若玩家已死亡,改为将这些牌置入弃牌堆(死亡玩家不再持牌)。
//   - toViewEvents:在 apply 之前调用,广播归还事件。信息分级——
//       owner 看到归还的牌面(自身原手牌);其他人只看到 count。
//   - applyView:owner 视角把牌追加进 view.hand;所有人 handCount += count。
//
// 触发时机:界谦逊 注册的 回合结束 after-hook 检测到 vars['界谦逊/移出'] 非空时调用。
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent, Card } from '../types';
import { registerAtom } from '../atom';
import { EXILE_VARS_KEY } from './移出游戏';

export const 归还移出牌: AtomDefinition<{ player: number }> = {
  type: '归还移出牌',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    const list = (state.players[atom.player].vars[EXILE_VARS_KEY] as string[] | undefined) ?? [];
    if (list.length === 0) return `player ${atom.player} 无移出游戏的手牌可归还`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const list = (player.vars[EXILE_VARS_KEY] as string[] | undefined) ?? [];
    delete player.vars[EXILE_VARS_KEY];
    if (!player.alive) {
      // 死亡玩家:归还的牌直接进弃牌堆
      for (const id of list) state.zones.discardPile.push(id);
      return;
    }
    for (const id of list) {
      if (!player.hand.includes(id)) player.hand.push(id);
    }
  },
  effect: { sound: 'draw', animation: 'slide', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    const list =
      (state.players[atom.player].vars[EXILE_VARS_KEY] as string[] | undefined) ?? [];
    const alive = state.players[atom.player].alive === true;
    const cards: Card[] = list.map((id) => state.cardMap[id]).filter((c): c is Card => !!c);
    const cardInfos = cards.map((c) => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank }));
    // 死亡:牌进弃牌堆,所有人可见牌面(归还事件降级为弃牌展示)
    if (!alive) {
      const view: ViewEvent = {
        type: '归还移出牌',
        player: atom.player,
        count: list.length,
        cards: cardInfos,
        toDiscard: true,
      };
      return { ownerViews: new Map(), othersView: view };
    }
    const ownerView: ViewEvent = {
      type: '归还移出牌',
      player: atom.player,
      cards: cardInfos,
    };
    const othersView: ViewEvent = {
      type: '归还移出牌',
      player: atom.player,
      count: list.length,
    };
    return { ownerViews: new Map([[atom.player, ownerView]]), othersView };
  },
  applyView(view: GameView, event: ViewEvent) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    const cards = event.cards as Array<{ id: string; name: string; suit: string; rank: string }> | undefined;
    const count = cards ? cards.length : ((event.count as number) ?? 0);
    if (event.toDiscard) {
      // 死亡:牌进弃牌堆,handCount 不变
      if (view.zones) view.zones.discardPileCount += count;
      return;
    }
    view.players[pi].handCount += count;
    // owner 视角:把归还的牌追加进 view.hand
    if (cards && view.players[pi].hand) {
      for (const c of cards) {
        const card = view.cardMap[c.id];
        if (card) {
          if (!view.players[pi].hand.some((x: Card) => x.id === c.id)) {
            view.players[pi].hand.push(card);
          }
        } else {
          view.players[pi].hand.push({
            id: c.id,
            name: c.name,
            suit: c.suit as Card['suit'],
            color: ('黑' as Card['color']),
            rank: c.rank,
            type: '基本牌',
          });
        }
      }
    }
  },
  toViewLog(event) {
    const count = ((event.cards as unknown[] | undefined)?.length) ?? (event.count as number) ?? 0;
    return { player: event.player as number, text: `谦逊:回合结束,归还 ${count} 张移出的手牌` };
  },
};

registerAtom(归还移出牌);
