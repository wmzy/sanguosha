// src/engine/atoms/武圣还原.ts
// 武圣还原:把 _wrapper 中的原始属性恢复(name/suit),删除 _wrapper
// (in-place mutation,保持与既有实现兼容)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 武圣还原: AtomDefinition<{ cardId: string }> = {
  type: '武圣还原',
  validate(state, atom) {
    const card = state.cardMap[atom.cardId] as typeof state.cardMap[string] & {
      _wrapper?: { fromSkill?: string };
    } | undefined;
    if (!card?._wrapper) return 'card not wrapped';
    if (card._wrapper.fromSkill !== '武圣') return 'wrapper is not from 武圣';
    return null;
  },
  apply(state, atom) {
    const card = state.cardMap[atom.cardId] as typeof state.cardMap[string] & {
      _wrapper?: { origName: string; origSuit: string; fromSkill: string };
    };
    if (card._wrapper) {
      card.name = card._wrapper.origName;
      card.suit = card._wrapper.origSuit as typeof card.suit;
      delete card._wrapper;
    }
    return state;
  },
};

registerAtom(武圣还原);
