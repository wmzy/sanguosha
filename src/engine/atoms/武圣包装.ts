// src/engine/atoms/武圣包装.ts
// 武圣包装:将一张红色牌的 name 临时改为 "杀",origName/origSuit 存到 _wrapper
// (in-place mutation,保持与既有实现兼容——见 plan §B7)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 武圣包装: AtomDefinition<{ cardId: string }> = {
  type: '武圣包装',
  validate(state, atom) {
    const card = state.cardMap[atom.cardId];
    if (!card) return 'card not found';
    const cardAny = card as typeof card & { _wrapper?: { fromSkill?: string } };
    if (cardAny._wrapper) return 'card already wrapped';
    if (card.suit !== '♥' && card.suit !== '♦') return '只能包装红色牌';
    return null;
  },
  apply(state, atom) {
    // in-place 改 cardMap[id](保持与既有实现兼容)
    const card = state.cardMap[atom.cardId] as typeof state.cardMap[string] & {
      _wrapper?: { origName: string; origSuit: string; fromSkill: string };
    };
    card._wrapper = { origName: card.name, origSuit: card.suit, fromSkill: '武圣' };
    card.name = '杀';
  },
};

registerAtom(武圣包装);
