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
  toViewEvents(state, atom): ViewEventSplit {
    // 携带阵亡玩家身份——死亡即公开,所有视角都需揭示
    const identity = state.players[atom.player]?.identity;
    const view: ViewEvent = { type: '击杀', player: atom.player, identity };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi >= 0) {
      const p = view.players[pi];
      // 弃牌堆计数:手牌数 + 装备数(与 apply 对称)
      // 用 p.handCount 而非 p.hand?.length —— 非 owner 的 hand 是 undefined
      const handCount = p.handCount;
      const equipCount = Object.values(p.equipment).filter(Boolean).length;
      if (view.zones) {
        view.zones.discardPileCount += handCount + equipCount;
      }
      p.alive = false;
      // 揭示阵亡身份(死亡即公开,所有视角可见)
      const identity = event.identity as string | undefined;
      if (identity) {
        p.identity = identity;
        p.identityHidden = false;
      }
      // 只有 owner(viewer === 阵亡玩家)才清 hand 为 [];
      // 非 owner 的 hand 是 undefined,保持 undefined
      if (view.viewer === (event.player as number)) {
        p.hand = [];
      }
      p.handCount = 0;
      p.equipment = {};
    }
  },
  toViewLog(event) {
    return { player: event.player as number, text: '阵亡' };
  },
};

registerAtom(击杀);
