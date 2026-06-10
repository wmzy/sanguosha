// src/engine/atoms/卸下.ts
// 卸下:玩家卸下指定槽位的装备,返回手牌
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 卸下: AtomDefinition<{ player: string; slot: '武器' | '防具' | '进攻马' | '防御马' | '宝物' }> = {
  type: '卸下',
  validate(state, atom) {
    const p = state.players.find(x => x.name === atom.player);
    if (!p) return `player ${atom.player} not found`;
    if (!p.equipment[atom.slot]) return `no equipment in slot ${atom.slot}`;
    return null;
  },
  apply(state, atom) {
    const pIdx = state.players.findIndex(p => p.name === atom.player);
    return {
      ...state,
      players: state.players.map((p, i) => {
        if (i !== pIdx) return p;
        const cardId = p.equipment[atom.slot]!;
        const equipment = { ...p.equipment };
        delete equipment[atom.slot];
        return { ...p, equipment, hand: [...p.hand, cardId] };
      }),
    };
  },
};

registerAtom(卸下);
