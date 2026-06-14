// src/engine/atoms/弃置.ts
// 弃置:从玩家手牌/装备区将 cardIds 移至弃牌堆
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 弃置: AtomDefinition<{ player: number; cardIds: string[] }> = {
  type: '弃置',
  validate(state, atom) {
    if (atom.cardIds.length === 0) return 'no cards to discard';
    const p = state.players[atom.player];
    if (!p) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const discardSet = new Set(atom.cardIds);
    player.hand = player.hand.filter(id => !discardSet.has(id));
    const equipment: Record<string, string> = {};
    for (const [slot, id] of Object.entries(player.equipment)) {
      if (id && !discardSet.has(id)) equipment[slot] = id;
    }
    player.equipment = equipment;
    state.zones.discardPile.push(...atom.cardIds);
  },
  effect: { sound: 'discard', animation: 'flip', duration: 200 },
};

registerAtom(弃置);
