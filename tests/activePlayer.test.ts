import { describe, it, expect } from 'vitest';
import type { GameState, PendingAction, TurnPhase } from '../engine/types';
import { getSingleActivePlayer } from '../src/utils/activePlayer';

function makeState(pending: PendingAction | null, phase: TurnPhase = '出牌', currentPlayer = 'P1'): GameState {
  return {
    meta: { round: 1, turnNumber: 1, status: '进行中', winner: null, seed: 1 },
    phase,
    currentPlayer,
    playerOrder: ['P1', 'P2', 'P3', 'P4'],
    players: {},
    zones: { deck: [], discardPile: [] },
    cardMap: {},
    turn: { current: 'P1', turnStartPlayer: 'P1', turnCount: 1 },
    pending,
    triggers: [],
    serverLog: [],
    playerLogs: {},
    rngState: 0,
  } as unknown as GameState;
}

describe('getSingleActivePlayer', () => {
  it('trickResponse 多 responder 时返回 defender（不是 null）', () => {
    const pending: PendingAction = {
      type: 'responseWindow',
      window: {
        type: 'trickResponse',
        attacker: 'P1',
        defender: 'P2',
        validCards: [],
        sourceCard: 'trick-1',
        trickTarget: 'P2',
        responders: ['P1', 'P2', 'P3', 'P4'],
        passedResponders: [],
        depth: 0,
        timeout: 1000,
        deadline: Date.now() + 1000,
      },
      id: 'p1',
      onTimeout: { type: 'respond', player: 'P2' },
      timeout: 1000,
      deadline: Date.now() + 1000,
    };
    const active = getSingleActivePlayer(makeState(pending));
    expect(active).toBe('P2');
  });

  it('trickResponse 嵌套时 defender 是新焦点', () => {
    const pending: PendingAction = {
      type: 'responseWindow',
      window: {
        type: 'trickResponse',
        attacker: 'P1',
        defender: 'P3',
        validCards: [],
        sourceCard: 'trick-1',
        trickTarget: 'P2',
        responders: ['P1', 'P3', 'P4'],
        passedResponders: ['P1', 'P2'],
        depth: 1,
        timeout: 1000,
        deadline: Date.now() + 1000,
      },
      id: 'p2',
      onTimeout: { type: 'respond', player: 'P3' },
      timeout: 1000,
      deadline: Date.now() + 1000,
    };
    const active = getSingleActivePlayer(makeState(pending));
    expect(active).toBe('P3');
  });

  it('aoeResponse 单 defender 正常返回', () => {
    const pending: PendingAction = {
      type: 'responseWindow',
      window: {
        type: 'aoeResponse',
        attacker: 'P1',
        defender: 'P2',
        validCards: [],
        sourceCard: 'trick-1',
        remainingTargets: ['P3', 'P4'],
        requiredCard: '闪',
        timeout: 1000,
        deadline: Date.now() + 1000,
      },
      id: 'p3',
      onTimeout: { type: 'respond', player: 'P2' },
      timeout: 1000,
      deadline: Date.now() + 1000,
    };
    const active = getSingleActivePlayer(makeState(pending));
    expect(active).toBe('P2');
  });

  it('dyingWindow 返回 currentSaver', () => {
    const pending: PendingAction = {
      type: 'dyingWindow',
      dyingPlayer: 'P1',
      savers: ['P1', 'P2', 'P3'],
      currentSaverIndex: 1,
      id: 'p4',
      onTimeout: { type: 'respond', player: 'P2' },
      timeout: 1000,
      deadline: Date.now() + 1000,
    };
    const active = getSingleActivePlayer(makeState(pending));
    expect(active).toBe('P2');
  });

  it('无 pending 时回退到 currentPlayer', () => {
    const active = getSingleActivePlayer(makeState(null, '出牌', 'P3'));
    expect(active).toBe('P3');
  });

  it('无 pending 且非出牌阶段返回 null', () => {
    const active = getSingleActivePlayer(makeState(null, '摸牌', 'P3'));
    expect(active).toBeNull();
  });
});
