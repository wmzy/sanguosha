// tests/integration/server-gameplay.test.ts
// 集成测试: GameSession 用新 ENGINE-DESIGN createEngine().dispatch() 跑真实玩法
import { describe, it, expect, beforeEach } from 'vitest';
import { GameSession } from '../../src/server/session';
import { createEngine } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

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
    name: '测试房间',
    maxPlayers: 2,
    hostId: 'P1_WS',
    isDebug: true,
    players,
    status: '等待中',
    readyPlayers: new Set(),
  };
}

function buildCombatReadyState(p2HasDodge = true): GameState {
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: ['c1'], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: p2HasDodge ? ['c2'] : [], equipment: {}, skills: p2HasDodge ? ['杀', '闪'] : ['杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: {
      c1: { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' },
      c2: { id: 'c2', name: '闪', suit: '♥', rank: 'A', type: '基本牌' },
    },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('新 ENGINE-DESIGN GameSession — 玩法集成', () => {
  let room: MockRoom;

  beforeEach(() => {
    room = makeMockRoom();
  });

  it('P1 出杀 → P2 不闪 → P2 扣 1 血 + 杀牌入弃牌堆', async () => {
    const state = buildCombatReadyState(false);
    const session = new GameSession(room as unknown as import('../../src/server/room').Room, true);
    session.restoreState(state, []);
    (session as unknown as { playerNames: Map<string, string> }).playerNames.set('P1_WS', 'P1');
    (session as unknown as { playerNames: Map<string, string> }).playerNames.set('P2_WS', 'P2');

    const p1 = state.players[0];
    const p2 = state.players[1];
    const originalHealth = p2.health;

    // 第一步:出杀 → 产生 pending
    await session.handleAction('P1_WS', {
      skillId: '杀',
      actionType: 'use',
      ownerId: p1.name,
      params: { cardId: 'c1', targets: [p2.name] },
      baseSeq: 0,
    });

    // 第二步:P2 不出闪 → 结算
    await session.handleAction('P2_WS', {
      skillId: '闪',
      actionType: 'respond',
      ownerId: p2.name,
      params: {},
      baseSeq: 0,
    });

    const after = session.getState()!;
    const p2After = after.players.find(p => p.name === p2.name)!;
    expect(p2After.health).toBe(originalHealth - 1);
    expect(after.zones.discardPile).toContain('c1');
  });

  it('回合管理 start → P1 摸 2 张,手牌 = 4(初始) + 2(摸牌) = 6', async () => {
    // 构建有足够牌堆的状态
    const deckCards: string[] = [];
    const cardMap: GameState['cardMap'] = {};
    for (let i = 0; i < 20; i++) {
      const id = `d${i}`;
      deckCards.push(id);
      cardMap[id] = { id, name: '杀', suit: '♠', rank: `${i + 1}`, type: '基本牌' };
    }
    // 每人初始 4 张手牌
    const p1Hand = deckCards.splice(0, 4);
    const p2Hand = deckCards.splice(0, 4);

    const state = createGameState({
      players: [
        { index: 0, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: p1Hand, equipment: {}, skills: ['回合管理'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
        { index: 1, name: 'P2', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: p2Hand, equipment: {}, skills: ['回合管理'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      ],
      cardMap,
      zones: { deck: deckCards, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });

    const engine = createEngine();
    engine.resetForTest();
    engine.bootstrap(state);

    // 触发 start action
    await engine.dispatch({
      skillId: '回合管理', actionType: 'start', ownerId: 'P1',
      params: {}, baseSeq: 0,
    });
    const after = engine.getState();

    const p1 = after.players.find(p => p.name === 'P1')!;
    const p2 = after.players.find(p => p.name === 'P2')!;
    // P1: 4(初始) + 2(摸牌阶段) = 6
    expect(p1.hand.length).toBe(6);
    // P2: 未摸牌,仍为 4
    expect(p2.hand.length).toBe(4);
    // 当前玩家应为 P1,阶段应为出牌
    expect(after.phase).toBe('出牌');
  });

  it('回合管理 end → P1 结束 → P2 接手进入出牌阶段(每玩家实例化)', async () => {
    // 验证 §4.14 设计:每个玩家一份 回合管理 实例,
    // 监听 上家回合结束 → 启动自己的回合
    const deckCards: string[] = [];
    const cardMap: GameState['cardMap'] = {};
    for (let i = 0; i < 20; i++) {
      const id = `d${i}`;
      deckCards.push(id);
      cardMap[id] = { id, name: '杀', suit: '♠', rank: `${i + 1}`, type: '基本牌' };
    }
    const p1Hand = deckCards.splice(0, 4);
    const p2Hand = deckCards.splice(0, 4);

    const state = createGameState({
      players: [
        { index: 0, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: p1Hand, equipment: {}, skills: ['回合管理'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
        { index: 1, name: 'P2', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: p2Hand, equipment: {}, skills: ['回合管理'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      ],
      cardMap,
      zones: { deck: deckCards, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });

    const engine = createEngine();
    engine.resetForTest();
    engine.bootstrap(state);

    // P1 开局
    await engine.dispatch({
      skillId: '回合管理', actionType: 'start', ownerId: 'P1', params: {}, baseSeq: 0,
    });
    const r1 = engine.getState();
    expect(r1.phase).toBe('出牌');
    expect(r1.currentPlayerIndex).toBe(0);
    expect(r1.players.find(p => p.name === 'P1')!.hand.length).toBe(6);

    // P1 结束回合
    await engine.dispatch({
      skillId: '回合管理', actionType: 'end', ownerId: 'P1', params: {}, baseSeq: 0,
    });
    const r2 = engine.getState();
    // 下一家 P2 应接手,且 P2 在摸牌阶段摸了 2 张
    expect(r2.currentPlayerIndex).toBe(1);
    expect(r2.phase).toBe('出牌');
    expect(r2.players.find(p => p.name === 'P2')!.hand.length).toBe(6);
  });
});
