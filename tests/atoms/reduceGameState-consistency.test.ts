import { describe, it, expect } from 'vitest';
import { applyAtoms } from '@engine/atom';
import { reduceGameState } from '@engine/view/reducer';
import { createTestGame } from '../engine-helpers';
import '@engine/atoms/index';
import type { GameState } from '@engine/types';

/**
 * #14: 验证 reduceGameState（前端 reducer）与 broadcast（后端 apply）的一致性。
 *
 * broadcast 返回 applyAtom 后的 GameState + serverLog 中的 ServerEvent[]。
 * reduceGameState 接收初始 GameState + ServerEvent[]，产出新 GameState。
 * 两者对游戏状态的修改应当一致（排除 serverLog / playerLogs / rngState 等日志字段）。
 *
 * 注意：当牌堆为空触发 reshuffle 时，前端 deck 状态会与后端不一致，
 * 因为服务端只推送 draw 事件而非 reshuffle 本身。这是事件溯源架构的固有限制，
 * 不影响实际游戏（服务端权威，客户端不依赖 deck 完整性）。
 */

/** 比较游戏状态（排除日志和 rngState） */
function expectSameGameState(a: GameState, b: GameState) {
  expect(a.zones).toEqual(b.zones);
  expect(a.players).toEqual(b.players);
  expect(a.currentPlayer).toBe(b.currentPlayer);
  expect(a.phase).toBe(b.phase);
  expect(a.pending).toEqual(b.pending);
  expect(a.turn).toEqual(b.turn);
  expect(a.meta).toEqual(b.meta);
  expect(a.cardMap).toEqual(b.cardMap);
  expect(a.playerOrder).toEqual(b.playerOrder);
}

describe('reduceGameState 与 broadcast 一致性', () => {
  it('draw: 前后端 apply 结果一致', () => {
    const state = createTestGame({ playerCount: 2, playPhase: true });
    // 保证 deck 充足，避免 reshuffle 导致 rngState 差异
    expect(state.zones.deck.length).toBeGreaterThan(5);

    const result = applyAtoms(state, [{ type: '摸牌', player: 'P1', count: 2 }]);
    const serverEvents = result.state.serverLog;
    const frontendState = reduceGameState(state, serverEvents);

    expectSameGameState(frontendState, result.state);
  });

  it('judge: 前后端 apply 结果一致', () => {
    const state = createTestGame({ playerCount: 2, playPhase: true });
    expect(state.zones.deck.length).toBeGreaterThan(5);

    const result = applyAtoms(state, [{ type: '判定', player: 'P1' }]);
    const serverEvents = result.state.serverLog;
    const frontendState = reduceGameState(state, serverEvents);

    expectSameGameState(frontendState, result.state);
  });

  it('damage: 前后端 apply 结果一致', () => {
    const state = createTestGame({ playerCount: 2, playPhase: true });

    const result = applyAtoms(state, [{ type: '造成伤害', target: 'P2', amount: 1 }]);
    const serverEvents = result.state.serverLog;
    const frontendState = reduceGameState(state, serverEvents);

    expectSameGameState(frontendState, result.state);
  });

  it('draw + judge + damage 组合: 前后端 apply 结果一致', () => {
    const state = createTestGame({ playerCount: 2, playPhase: true });
    expect(state.zones.deck.length).toBeGreaterThan(10);

    const atoms = [
      { type: '摸牌' as const, player: 'P1', count: 3 },
      { type: '判定' as const, player: 'P2' },
      { type: '造成伤害' as const, target: 'P2', amount: 1 },
    ];

    const result = applyAtoms(state, atoms);
    const serverEvents = result.state.serverLog;
    const frontendState = reduceGameState(state, serverEvents);

    expectSameGameState(frontendState, result.state);
  });

  it('draw 牌堆为空触发 reshuffle 时: 玩家手牌一致（deck 会因架构限制而不一致）', () => {
    let state = createTestGame({ playerCount: 2, playPhase: true });
    const cardC1 = { id: 'c1', name: '杀', type: '基本牌' as const, subtype: '杀' as const, suit: '♥' as const, rank: 'A' as const, description: '' };
    const cardC2 = { id: 'c2', name: '闪', type: '基本牌' as const, subtype: '闪' as const, suit: '♦' as const, rank: 'K' as const, description: '' };
    state = {
      ...state,
      zones: { deck: [], discardPile: ['c1', 'c2'] },
      cardMap: { ...state.cardMap, c1: cardC1, c2: cardC2 },
    };

    const result = applyAtoms(state, [{ type: '摸牌', player: 'P1', count: 1 }]);
    const serverEvents = result.state.serverLog;
    const frontendState = reduceGameState(state, serverEvents);

    // 玩家手牌一致（draw 事件携带了实际抽到的 cards）
    expect(frontendState.players.P1.hand).toEqual(result.state.players.P1.hand);
    // deck 会不一致：服务端做了 reshuffle 并修改了 deck，但前端只收到 draw 事件
    // 这是事件溯源架构的固有限制，不影响实际游戏（服务端权威）
  });
});
