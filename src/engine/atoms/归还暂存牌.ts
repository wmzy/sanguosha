// 归还暂存牌:把此前 移出至暂存区 atom 暂存的牌归还目标手牌。
//
// 通用归还操作,与 移出至暂存区 配对。服务于所有"暂时移出→到时归还"型技能:
//   - 界徐盛·界破军:回合结束归还 target.vars['界破军/移出']。
//   - 界陆逊·界谦逊:回合结束归还 player.vars['界谦逊/移出']。
//
// 旧实现 破军归还 / 归还移出牌 是两份逐行同构的代码,差异仅 vars key 字面值。
// 本 atom 把 vars key 参数化,合并为一份。
//
// 设计(与 移出至暂存区 的逆操作对称):
//   - apply:把 vars[varsKey] 中的全部 cardId 追加回 player.hand,并清空该 vars 键。
//     若 player 已死亡,改为将这些牌置入弃牌堆(死亡玩家不再持牌)。
//   - toViewEvents:在 apply 之前调用,广播归还事件。信息分级——
//       target 看到归还的牌面(自身原牌);其他人只看到 count。
//   - applyView:target 视角把牌追加进 view.hand;所有人 handCount += count。
//
// 触发时机:具体技能(界破军/界谦逊)注册的 回合结束 after-hook 检测到
//   对应 vars[varsKey] 非空时调用本 atom。
import type { AtomDefinition, Card, GameView, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 归还暂存牌: AtomDefinition<{ player: number; varsKey: string }> = {
  type: '归还暂存牌',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (typeof atom.varsKey !== 'string' || atom.varsKey.length === 0) return `varsKey 不能为空`;
    const list = (state.players[atom.player].vars[atom.varsKey] as string[] | undefined) ?? [];
    if (list.length === 0) return `player ${atom.player} 的 vars['${atom.varsKey}'] 无暂存牌可归还`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const list = (player.vars[atom.varsKey] as string[] | undefined) ?? [];
    delete player.vars[atom.varsKey];
    if (!player.alive) {
      // 死亡:归还的牌直接进弃牌堆
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
      (state.players[atom.player].vars[atom.varsKey] as string[] | undefined) ?? [];
    const alive = state.players[atom.player].alive === true;
    const cards: Card[] = list.map((id) => state.cardMap[id]).filter((c): c is Card => !!c);
    const cardInfos = cards.map((c) => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank }));
    // 死亡:牌进弃牌堆,所有人可见牌面
    if (!alive) {
      const view: ViewEvent = {
        type: '归还暂存牌',
        player: atom.player,
        count: list.length,
        cards: cardInfos,
        toDiscard: true,
      };
      return { ownerViews: new Map(), othersView: view };
    }
    const ownerView: ViewEvent = {
      type: '归还暂存牌',
      player: atom.player,
      cards: cardInfos,
    };
    const othersView: ViewEvent = {
      type: '归还暂存牌',
      player: atom.player,
      count: list.length,
    };
    return { ownerViews: new Map([[atom.player, ownerView]]), othersView };
  },
  applyView(view: GameView, event: ViewEvent) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    const cards = event.cards as
      | Array<{ id: string; name: string; suit: string; rank: string }>
      | undefined;
    const count = cards ? cards.length : ((event.count as number) ?? 0);
    if (event.toDiscard) {
      // 死亡:牌进弃牌堆,handCount 不变
      if (view.zones) view.zones.discardPileCount += count;
      return;
    }
    view.players[pi].handCount += count;
    // target 视角:把归还的牌追加进 view.hand
    if (cards && view.players[pi].hand) {
      for (const c of cards) {
        const card = view.cardMap[c.id];
        if (card) {
          if (!view.players[pi].hand.some((x: Card) => x.id === c.id)) {
            view.players[pi].hand.push(card);
          }
        }
      }
    }
  },
  toViewLog(event) {
    const count = ((event.cards as unknown[] | undefined)?.length) ??
      (event.count as number) ??
      0;
    return {
      player: event.player as number,
      text: `归还 ${count} 张移出的牌`,
    };
  },
};

registerAtom(归还暂存牌);
