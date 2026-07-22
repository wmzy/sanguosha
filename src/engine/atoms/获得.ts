// src/engine/atoms/获得.ts
// 获得:玩家获得一张牌(可选从指定玩家处)
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 获得: AtomDefinition<{ player: number; cardId: string; from?: number }> = {
  type: '获得',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (atom.from !== undefined && !state.players[atom.from]) return `from ${atom.from} not found`;
    return null;
  },
  apply(state, atom) {
    if (atom.from !== undefined) {
      const fromP = state.players[atom.from];
      fromP.hand = fromP.hand.filter((id) => id !== atom.cardId);
      const equipment: Record<string, string> = {};
      for (const [slot, id] of Object.entries(fromP.equipment)) {
        if (id && id !== atom.cardId) equipment[slot] = id;
      }
      fromP.equipment = equipment;
    }
    state.players[atom.player].hand.push(atom.cardId);
  },
  effect: { sound: 'obtain', animation: 'slide', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    const effect = { sound: 'obtain' as const, animation: 'slide' as const, duration: 600 };
    // 判断牌来自哪个区域(供 applyView 精确更新)
    const fromZone =
      atom.from !== undefined
        ? state.players[atom.from].hand.includes(atom.cardId)
          ? ('hand' as const)
          : ('equipment' as const)
        : undefined;
    // ownerView:获得者看到完整牌信息
    const ownerView: ViewEvent = {
      type: '获得',
      player: atom.player,
      cardId: atom.cardId,
      cardName: state.cardMap[atom.cardId]?.name,
      ...(atom.from !== undefined ? { from: atom.from, fromZone } : {}),
      effect,
    };
    // othersView:第三方只看到「谁从谁那里获得了一张牌」不暴露 cardId
    // 例外:from 为装备区时须带 cardId —— 装备牌为公开信息,且 applyView 需 cardId
    // 才能在第三方视角正确清空装备槽(否则第三方视图装备槽残留,与权威 buildView 不一致)
    const othersView: ViewEvent = {
      type: '获得',
      player: atom.player,
      ...(atom.from !== undefined ? { from: atom.from, fromZone } : {}),
      ...(fromZone === 'equipment' ? { cardId: atom.cardId } : {}),
      effect,
    };
    // 给予者也需要看到 cardId 以同步手牌移除(applyView 需要 cardId 做 filter)
    const ownerViews = new Map([[atom.player, ownerView]]);
    if (atom.from !== undefined) {
      ownerViews.set(atom.from, ownerView);
    }
    return { ownerViews, othersView };
  },
  applyView(view, event) {
    const cardId = event.cardId as string | undefined;
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    view.players[pi].handCount += 1;
    if (cardId && view.players[pi].hand) {
      const card = view.cardMap[cardId];
      if (card) view.players[pi].hand.push(card);
    }
    // from 玩家:手牌/装备移除(与 apply 对称)
    const from = event.from as number | undefined;
    const fromZone = event.fromZone as 'hand' | 'equipment' | undefined;
    if (from !== undefined) {
      const fromPi = view.players.findIndex((p) => p.index === from);
      if (fromPi >= 0) {
        if (fromZone === 'equipment') {
          // 从装备区移除
          const equipment: Partial<Record<string, string>> = {};
          for (const [slot, id] of Object.entries(view.players[fromPi].equipment)) {
            if (id && id !== cardId) equipment[slot] = id;
          }
          view.players[fromPi].equipment = equipment;
        } else {
          // 从手牌移除:handCount - 1;可见时同步 hand 数组
          view.players[fromPi].handCount = Math.max(0, view.players[fromPi].handCount - 1);
          if (cardId && view.players[fromPi].hand) {
            view.players[fromPi].hand = view.players[fromPi].hand.filter((c) => c.id !== cardId);
          }
        }
      }
    }
  },
  toViewLog(event, viewer, resolveName) {
    const player = event.player as number;
    const cardName = event.cardName as string | undefined;
    const from = event.from as number | undefined;
    // owner 视角(获得者/给予者)能看到具体牌面
    const isOwner = player === viewer || from === viewer;
    if (from !== undefined) {
      const fromName = resolveName?.(from) ?? `P${from}`;
      if (isOwner && cardName) {
        return { player, text: `从 ${fromName} 处获得了 ${cardName}` };
      }
      return { player, text: `从 ${fromName} 处获得了一张牌` };
    }
    if (isOwner && cardName) {
      return { player, text: `获得了 ${cardName}` };
    }
    return { player, text: '获得了一张牌' };
  },
};

registerAtom(获得);
