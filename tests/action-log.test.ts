import { describe, it, expect } from 'vitest';
import { actionLogToOperations } from '@engine/view/actionLog';
import { createTestGame } from './engine-helpers';
import type { GameState } from '@engine/types';

describe('actionLog → Operation[] 转换', () => {
  it('startGame 转 gameStart', () => {
    const state = createTestGame();
    const ops = actionLogToOperations([{ type: 'startGame' }], state);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('gameStart');
    expect(ops[0].description).toContain('游戏开始');
  });

  it('endTurn 转 turnChange + 包含玩家名', () => {
    const state = createTestGame();
    const ops = actionLogToOperations([{ type: 'endTurn', player: 'P1' }], state);
    expect(ops[0].type).toBe('turnChange');
    expect(ops[0].description).toContain('P1');
  });

  it('playCard 转 play + 包含卡牌名', () => {
    const state = createTestGame();
    const cardId = state.players['P1'].hand[0];
    const ops = actionLogToOperations([{ type: 'playCard', player: 'P1', cardId, target: 'P2' }], state);
    expect(ops[0].type).toBe('play');
    expect(ops[0].description).toContain(state.cardMap[cardId].name);
    expect(ops[0].description).toContain('P2');
  });

  it('discard 转 discard + 包含多张牌名', () => {
    const state = createTestGame();
    const cardIds = state.players['P1'].hand.slice(0, 2);
    const ops = actionLogToOperations([{ type: 'discard', player: 'P1', cardIds }], state);
    expect(ops[0].type).toBe('discard');
    expect(ops[0].description).toContain(cardIds.map(id => state.cardMap[id].name).join('、'));
  });

  it('useSkill 转 skillActivate', () => {
    const state = createTestGame();
    const ops = actionLogToOperations([{ type: 'useSkill', player: 'P1', skillId: '苦肉' }], state);
    expect(ops[0].type).toBe('skillActivate');
    expect(ops[0].description).toContain('苦肉');
  });

  it('seq 从 1 递增', () => {
    const state = createTestGame();
    const actions = [
      { type: 'startGame' as const },
      { type: 'endTurn' as const, player: 'P1' },
      { type: 'endTurn' as const, player: 'P2' },
    ];
    const ops = actionLogToOperations(actions, state);
    expect(ops.map(o => o.seq)).toEqual([1, 2, 3]);
  });
});
