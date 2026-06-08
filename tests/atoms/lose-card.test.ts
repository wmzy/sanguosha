import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, withHand, withEquipment } from '../engine-helpers';

describe('loseCard atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('loseCard: hand → discardPile', () => {
    const s0 = withHand(createTestGame(), 'P1', ['c1', 'c2']);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '失去牌', cardId: 'c1', from: { zone: '手牌', player: 'P1' } },
    ]);
    expect(state.players.P1.hand).toEqual(['c2']);
    expect(state.zones.discardPile).toContain('c1');
    expect(events[0].atom.type).toBe('失去牌');
  });

  it('loseCard: equipment → discardPile（带装备 slot 清理）', () => {
    const s0 = withEquipment(createTestGame(), 'P1', { 武器: 'wpn1' });
    const { state } = applyAtoms(s0, [
      { type: '失去牌', cardId: 'wpn1', from: { zone: '装备', player: 'P1', slot: '武器' } },
    ]);
    expect(state.players.P1.equipment.武器).toBeUndefined();
    expect(state.zones.discardPile).toContain('wpn1');
  });

  it('loseCard 找不到 cardId 时 noop（不报错）', () => {
    const s0 = withHand(createTestGame(), 'P1', ['c1']);
    const { state } = applyAtoms(s0, [
      { type: '失去牌', cardId: 'ghost', from: { zone: '手牌', player: 'P1' } },
    ]);
    expect(state.players.P1.hand).toEqual(['c1']);
  });
});
