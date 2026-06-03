import { describe, it, expect } from 'vitest';
import { safeEngine as engine } from '../../invariants';
import { createTestGame, getCharacterMap } from '../../engine-helpers';
import { registerCharacterTriggers, clearTurnVars, emitEvent } from '@engine/skill';
import { advanceToInteractivePhase } from '@engine/phase-advance';

const charMap = getCharacterMap();

describe('许褚 - 裸衣（少摸 1 张）', () => {
  it('裸衣标记 active 时摸牌阶段只摸 1 张', () => {
    let state = createTestGame({ characters: ['许褚', '刘备'], seed: 42 });
    state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
    state = clearTurnVars(state);
    state = { ...state, phase: '摸牌', pending: null };

    const r1 = emitEvent(state, { type: 'phaseBegin', phase: '摸牌', player: 'P1' });
    const r2 = engine(r1.state, { type: 'skillChoice', player: 'P1', choice: true });
    const r3 = advanceToInteractivePhase(r2.state);

    expect(r2.error).toBeUndefined();
    expect(r2.state.players.P1.vars['裸衣/active']).toBe(true);
    expect(r3.state.players.P1.vars['裸衣/active']).toBe(true);
    const p1HandAfter = r3.state.players['P1'].hand.length;
    const p1DeckAfter = r3.state.zones.deck.length;
    const p1HandBefore = state.players['P1'].hand.length;
    const p1DeckBefore = state.zones.deck.length;
    expect(p1HandAfter - p1HandBefore).toBe(1);
    expect(p1DeckBefore - p1DeckAfter).toBe(1);
  });

  it('不发动裸衣时摸牌阶段摸 2 张', () => {
    let state = createTestGame({ characters: ['刘备', '张飞'], seed: 42 });
    state = clearTurnVars(state);
    state = { ...state, phase: '摸牌', pending: null };

    const r3 = advanceToInteractivePhase(state);

    const p1HandAfter = r3.state.players['P1'].hand.length;
    const p1DeckAfter = r3.state.zones.deck.length;
    const p1HandBefore = state.players['P1'].hand.length;
    const p1DeckBefore = state.zones.deck.length;
    expect(p1HandAfter - p1HandBefore).toBe(2);
    expect(p1DeckBefore - p1DeckAfter).toBe(2);
  });
});
