// src/engine/atoms/击杀.ts
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 击杀: AtomDefinition<{ player: number }> = {
  type: '击杀',
  validate(state, atom) {
    const p = state.players[atom.player];
    if (!p) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const p = state.players[atom.player];
    p.alive = false;
    // 死亡:手牌和装备进入弃牌堆
    for (const cardId of p.hand) state.zones.discardPile.push(cardId);
    p.hand = [];
    for (const slot of Object.keys(p.equipment) as Array<keyof typeof p.equipment>) {
      const equipId = p.equipment[slot];
      if (equipId) {
        state.zones.discardPile.push(equipId);
        delete p.equipment[slot];
      }
    }
  },
  effect: { sound: 'death', animation: 'fade', duration: 1500 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = { type: '击杀', player: atom.player };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi >= 0) {
      const p = view.players[pi];
      // 弃牌堆计数:手牌数 + 装备数(与 apply 对称)
      const handCount = p.hand?.length ?? 0;
      const equipCount = Object.values(p.equipment).filter(Boolean).length;
      if (view.zones) {
        view.zones.discardPileCount += handCount + equipCount;
      }
      p.alive = false;
      p.hand = [];
      p.handCount = 0;
      p.equipment = {};
    }
  },
  toViewLog(event) {
    return { player: event.player as number, text: '阵亡' };
  },
};

registerAtom(击杀);
