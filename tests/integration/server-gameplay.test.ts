// tests/integration/server-gameplay.test.ts
// 集成测试: GameSession 用新 ENGINE-DESIGN createEngine().dispatch() 跑真实玩法
import { describe, it, expect, beforeEach } from 'vitest';
import { GameSession } from '../../src/server/session';
import { createEngine } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { GameState } from '../../src/engine/types';

interface MockRoom {
  id: string;
  name: string;
  maxPlayers: number;
  hostId: string;
  isDebug: boolean;
  players: Map<string, { send: (data: string) => void }>;
  status: '等待中';
  readyPlayers: Set<string>;
}

function makeMockRoom(): MockRoom {
  const ws = { send: () => {} };
  const players = new Map<string, { send: (data: string) => void }>();
  players.set('P1_WS', ws);
  players.set('P2_WS', ws);
  return {
    id: 'room1',
    name: 'test-room',
    maxPlayers: 2,
    hostId: 'P1_WS',
    isDebug: true,
    players,
    status: '等待中',
    readyPlayers: new Set<string>(),
  };
}

function buildCombatReadyState(p2HasDodge = true): GameState {
  return {
    players: [
      { index: 0, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: ['c1'], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [] },
      { index: 1, name: 'P2', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: p2HasDodge ? ['c2'] : [], equipment: {}, skills: p2HasDodge ? ['杀', '闪'] : ['杀'], vars: {}, marks: [], pendingTricks: [] },
    ],
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    zones: { deck: [], discardPile: [], processing: [] },
    settlementStack: [],
    cardMap: {
      c1: { id: 'c1', name: '杀', suit: '♠', rank: 1, type: '基本牌' },
      c2: { id: 'c2', name: '闪', suit: '♥', rank: 1, type: '基本牌' },
    },
    rngSeed: 1,
    marks: [],
    localVars: {},
    meta: { gameId: 'g1', createdAt: 0 },
    seq: 0,
    startedAt: 0,
    actionLog: [],
  };
}

describe('新 ENGINE-DESIGN GameSession — 玩法集成', () => {
  let room: MockRoom;

  beforeEach(() => {
    room = makeMockRoom();
  });

  it('P1 出杀 → P2 不闪 → P2 扣 1 血 + 杀牌入弃牌堆', async () => {
    const state = buildCombatReadyState(false);
    const session = new GameSession(room, true);
    // restoreState 之前先 set playerNames(restoreState 会 clear)
    session.restoreState(state, []);
    (session as unknown as { playerNames: Map<string, string> }).playerNames.set('P1_WS', 'P1');
    (session as unknown as { playerNames: Map<string, string> }).playerNames.set('P2_WS', 'P2');

    const p1 = state.players[0];
    const p2 = state.players[1];
    const originalHealth = p2.health;

    await session.handleAction('P1_WS', {
      skillId: '杀',
      actionType: 'use',
      ownerId: p1.name,
      params: { cardId: 'c1', targets: [p2.name] },
    });

    const after = session.getState()!;
    const p2After = after.players.find(p => p.name === p2.name)!;
    expect(p2After.health).toBe(originalHealth - 1);
    expect(after.zones.discardPile).toContain('c1');
  });

  it('CAS 校验: baseSeq 不匹配静默丢弃', async () => {
    const state = buildCombatReadyState(false);
    const session = new GameSession(room, true);
    session.restoreState(state, []);
    (session as unknown as { playerNames: Map<string, string> }).playerNames.set('P1_WS', 'P1');
    (session as unknown as { playerNames: Map<string, string> }).playerNames.set('P2_WS', 'P2');

    const p1 = state.players[0];
    const p2 = state.players[1];
    const beforeHealth = p2.health;
    await session.handleAction('P1_WS', {
      skillId: '杀',
      actionType: 'use',
      ownerId: p1.name,
      params: { cardId: 'c1', targets: [p2.name] },
    }, 99);

    const after = session.getState()!;
    const p2After = after.players.find(p => p.name === p2.name)!;
    expect(p2After.health).toBe(beforeHealth);
    expect(after.zones.discardPile).not.toContain('c1');
  });

  it('回合管理 start → P1 摸 2 张,手牌 = 4(初始) + 2(摸牌) = 6', async () => {
    // 构建有足够牌堆的状态
    const deckCards: string[] = [];
    const cardMap: GameState['cardMap'] = {};
    for (let i = 0; i < 20; i++) {
      const id = `d${i}`;
      deckCards.push(id);
      cardMap[id] = { id, name: '杀', suit: '♠', rank: i + 1, type: '基本牌' };
    }
    // 每人初始 4 张手牌
    const p1Hand = deckCards.splice(0, 4);
    const p2Hand = deckCards.splice(0, 4);

    const state: GameState = {
      players: [
        { index: 0, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: p1Hand, equipment: {}, skills: ['回合管理'], vars: {}, marks: [], pendingTricks: [] },
        { index: 1, name: 'P2', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: p2Hand, equipment: {}, skills: ['回合管理'], vars: {}, marks: [], pendingTricks: [] },
      ],
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
      zones: { deck: deckCards, discardPile: [], processing: [] },
      settlementStack: [],
      cardMap,
      rngSeed: 1,
      marks: [],
      localVars: {},
      meta: { gameId: 'g1', createdAt: 0 },
      seq: 0,
      startedAt: 0,
      actionLog: [],
    };

    const engine = createEngine();
    engine.resetForTest();
    const bootState = engine.bootstrap(state);

    // 触发 start action
    const after = await engine.dispatch(bootState, {
      skillId: '回合管理', actionType: 'start', ownerId: 'P1',
      params: {}, baseSeq: 0,
    });

    const p1 = after.players.find(p => p.name === 'P1')!;
    const p2 = after.players.find(p => p.name === 'P2')!;
    // P1: 4(初始) + 2(摸牌阶段) = 6
    expect(p1.hand.length).toBe(6);
    // P2: 未摸牌,仍为 4
    expect(p2.hand.length).toBe(4);
    // 当前玩家应为 P1,阶段应为出牌
    expect(after.phase).toBe('出牌');
  });
});
