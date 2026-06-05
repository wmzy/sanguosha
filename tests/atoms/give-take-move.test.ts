import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('giveCard / takeCard / moveCard', () => {
  beforeEach(() => {
    clearAtomRegistry();
    registerAllAtoms();
  });

  it('moveCard: hand → discardPile', () => {
    const s0 = createTestGame({ hand: { P1: ['c1'] } });
    const { state, events } = applyAtoms(s0, [{
      type: 'moveCard',
      cardId: 'c1',
      from: { zone: 'hand', player: 'P1' },
      to: { zone: 'discardPile' },
    }]);
    expect(state.players.P1.hand).toEqual([]);
    expect(state.zones.discardPile).toEqual(['c1']);
    // moveCard 原子 emit 的服务端事件类型沿用 'cardMoved'（与 view/reducer 兼容）
    expect(events[0].type).toBe('cardMoved');
  });

  it('giveCard: P1 → P2', () => {
    const s0 = createTestGame({ hand: { P1: ['c1'] } });
    const { state } = applyAtoms(s0, [{
      type: 'giveCard',
      cardId: 'c1',
      from: 'P1',
      to: 'P2',
    }]);
    expect(state.players.P1.hand).toEqual([]);
    expect(state.players.P2.hand).toEqual(['c1']);
  });

  it('takeCard: deck → P1.hand', () => {
    const s0 = createTestGame({ deck: ['c1', 'c2'] });
    const { state } = applyAtoms(s0, [{ type: 'takeCard', cardId: 'c1', to: 'P1' }]);
    expect(state.zones.deck).toEqual(['c2']);
    expect(state.players.P1.hand).toContain('c1');
  });

  it('giveCard: 源玩家手牌没有该 cardId 时静默追加到目标手牌（不抛错）', () => {
    const s0 = createTestGame({ hand: { P1: ['other'], P2: [] } });
    const { state } = applyAtoms(s0, [{
      type: 'giveCard',
      cardId: 'c-missing',
      from: 'P1',
      to: 'P2',
    }]);
    // P1 的手牌保持不变（c-missing 本就不在）
    expect(state.players.P1.hand).toEqual(['other']);
    // P2 收到 c-missing（与 discard 等其它原子一致：不做源区存在性校验）
    expect(state.players.P2.hand).toEqual(['c-missing']);
  });

  it('giveCard 写入 serverLog 含 from/to 字段', () => {
    const s0 = createTestGame({ hand: { P1: ['c1'] } });
    const { events } = applyAtoms(s0, [{ type: 'giveCard', cardId: 'c1', from: 'P1', to: 'P2' }]);
    expect(events[0].payload).toMatchObject({ from: 'P1', to: 'P2', cardId: 'c1' });
  });
});
