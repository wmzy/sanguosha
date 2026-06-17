// LEGACY TEST: references deleted v2 modules - skipped
import { describe, it, expect } from 'vitest';
// import { actionLogToOperations } from '@engine/view/actionLog';  // LEGACY: removed (v2 module deleted)
import { createTestGame } from './engine-helpers';
import type { GameState } from '@engine/types';

describe.skip('actionLog → Operation[] 转换', () => {
  it('startGame 转 gameStart', () => {
    const state = createTestGame();
    const ops = actionLogToOperations([{ type: '开始' }], state);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('游戏开始');
    expect(ops[0].description).toContain('游戏开始');
  });

  it('endTurn 转 turnChange + 包含玩家名', () => {
    const state = createTestGame();
    const ops = actionLogToOperations([{ type: '结束回合', player: 'P1' }], state);
    expect(ops[0].type).toBe('回合变更');
    expect(ops[0].description).toContain('P1');
  });

  it('playCard 转 play + 包含卡牌名', () => {
    const state = createTestGame();
    const cardId = state.players['P1'].hand[0];
    const ops = actionLogToOperations([{ type: '打出一张牌', player: 'P1', cardId, target: 'P2' }], state);
    expect(ops[0].type).toBe('出牌');
    expect(ops[0].description).toContain(state.cardMap[cardId].name);
    expect(ops[0].description).toContain('P2');
  });

  it('discard 转 discard + 包含多张牌名', () => {
    const state = createTestGame();
    const cardIds = state.players['P1'].hand.slice(0, 2);
    const ops = actionLogToOperations([{ type: '弃置', player: 'P1', cardIds }], state);
    expect(ops[0].type).toBe('弃置');
    expect(ops[0].description).toContain(cardIds.map(id => state.cardMap[id].name).join('、'));
  });

  it('useSkill 转 skillActivate', () => {
    const state = createTestGame();
    const ops = actionLogToOperations([{ type: '使用技能', player: 'P1', skillId: '苦肉' }], state);
    expect(ops[0].type).toBe('技能发动');
    expect(ops[0].description).toContain('苦肉');
  });

  it('seq 从 1 递增', () => {
    const state = createTestGame();
    const actions = [
      { type: '开始' as const },
      { type: '结束回合' as const, player: 'P1' },
      { type: '结束回合' as const, player: 'P2' },
    ];
    const ops = actionLogToOperations(actions, state);
    expect(ops.map(o => o.seq)).toEqual([1, 2, 3]);
  });
});
