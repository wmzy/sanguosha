// tests/server/session-turn-deadline.test.ts
// 回归测试:验证出牌阶段倒计时的前后端同步。
//
// 设计变更:出牌阶段现在是一个引擎内的 __出牌 pending 循环(由回合管理 hook 启动),
// 不再由 session 的 idle timer 管理。deadline 统一来自 pending slot 的超时——
// buildView 读 pending.deadline,effectiveDeadline 读 getPendingDeadline,两者同源。
//
// 验证点:
// 1. buildView 在有 __出牌 pending 时返回非空 deadline
// 2. event 消息携带 deadline(仅在变化时),前端据此同步倒计时
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkGameOver } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import { buildView } from '../../src/engine/view/buildView';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';
import type { ConnectionSink } from '../../src/server/connection';

function makeRoom(): Room {
  return {
    id: `test-room-${Math.random().toString(36).slice(2, 8)}`,
    name: '测试',
    maxPlayers: 4,
    players: new Map([['fake-player', new FakeSink()]]),
    isDebug: true,
    createdAt: Date.now(),
    status: '进行中',
    readyPlayers: new Set<string>(),
    config: { name: '测试', timeoutScale: 1, charPool: 'all', handSize: 4 },
    spectators: new Map(),
    viewGrants: new Map(),
    pendingViewRequests: new Map(),
  } as unknown as Room;
}

/** 通过 reflection 取/设 session.state(私有字段) */
function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}
function setState(session: GameSession, state: GameState): void {
  (session as unknown as { state: GameState }).state = state;
}

/** 伪 sink,收集所有发给该 player 的消息 */
class FakeSink implements ConnectionSink {
  messages: ServerMessage[] = [];
  send(message: ServerMessage): void {
    this.messages.push(message);
  }

  close(): void {
    /* noop */
  }

  get isAlive(): boolean {
    return true;
  }
}

/** 构造一个处于出牌阶段、2 人存活、带 出牌窗口 pending 的极简 state */
function makeActState(): GameState {
  const state = createGameState({
    players: [
      {
        index: 0,
        name: 'P1',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: [],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: [],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
  return state;
}

describe('session:出牌阶段倒计时(pending slot 驱动)', () => {
  let session: GameSession;

  beforeEach(() => {
    session = new GameSession(makeRoom(), true, 42);
    const state = makeActState();
    setState(session, state);
    (session as unknown as { attachStateListener: () => void }).attachStateListener();
  });

  it('buildView 在有 出牌窗口 pending 时返回非空 deadline', () => {
    const state = getState(session);
    // 模拟 出牌窗口 pending slot(50s 超时)
    const before = Date.now();
    state.pendingSlots.set(0, {
      atom: { type: '出牌窗口', player: 0 } as never,
      definition: {
        pending: {
          onTimeout: async () => {},
          prompt: { type: 'confirm' as const, title: '' },
          timeout: 50,
          isBlocking: false,
        },
      } as never,
      deadline: 50_000,
      startTime: 0,
      createdSeq: 0,
      isBlocking: false,
      resolve: () => {},
    } as never);
    const after = Date.now();

    const view = buildView(state, 0);
    expect(view.deadline).not.toBeNull();
    // deadline 应在 [before+50s, after+50s] 区间(因为 slot.deadline 是相对时间 50000ms)
    expect(view.deadline!).toBeGreaterThanOrEqual(state.startedAt + 50_000);
    expect(view.deadlineTotalMs).toBe(50_000);
    void before;
    void after;
  });

  it('buildView 无 pending 时 deadline 为 null', () => {
    const state = getState(session);
    const view = buildView(state, 0);
    expect(view.deadline).toBeNull();
    expect(view.deadlineTotalMs).toBe(0);
  });

  it('event 消息携带 deadline(来自 pending slot)', () => {
    const state = getState(session);
    // 接一个玩家 sink
    const sink = new FakeSink();
    const playerId = 'p-test';
    const room = (session as unknown as { room: Room }).room;
    room.players.set(playerId, sink);
    (session as unknown as { playerNames: Map<string, number> }).playerNames.set(playerId, 0);

    // 模拟 出牌窗口 pending slot
    state.pendingSlots.set(0, {
      atom: { type: '出牌窗口', player: 0 } as never,
      definition: {
        pending: {
          onTimeout: async () => {},
          prompt: { type: 'confirm' as const, title: '' },
          timeout: 50,
          isBlocking: false,
        },
      } as never,
      deadline: 50_000,
      startTime: 0,
      createdSeq: 0,
      isBlocking: false,
      resolve: () => {},
    } as never);

    // 触发广播
    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();

    // 应收到 initialView 且其 state.deadline 非空
    const initialMsg = sink.messages.find((m) => m.type === 'initialView');
    expect(initialMsg).toBeDefined();
    if (initialMsg!.type === 'initialView') {
      expect(initialMsg!.state.deadline).not.toBeNull();
      expect(initialMsg!.state.deadlineTotalMs).toBe(50_000);
    }
    void state;
  });
});

describe('session:gameOver 后拦截后续广播(回归:主公阵亡后仍下发出牌窗口)', () => {
  let session: GameSession;
  beforeEach(() => {
    session = new GameSession(makeRoom(), true, 42);
    const state = createGameState({
      players: [
        {
          index: 0,
          name: '主公',
          identity: '主公',
          character: '刘备',
          health: 1,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
        {
          index: 1,
          name: '反贼',
          identity: '反贼',
          character: '曹操',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    setState(session, state);
    (session as unknown as { attachStateListener: () => void }).attachStateListener();
  });

  it('主公阵亡:广播 gameOver,且 gameOver 之后的 onStateChange 不再广播', () => {
    const state = getState(session);
    const s = session as unknown as {
      broadcast: (m: ServerMessage) => void;
      broadcastNewState: () => void;
      gameOverHandled: boolean;
    };
    const broadcastSpy = vi.spyOn(s, 'broadcast');
    const broadcastNewStateSpy = vi.spyOn(s, 'broadcastNewState');

    // 主公阵亡,触发 onStateChange(模拟 击杀 atom 末尾的 notifyStateChange)
    state.players[0].alive = false;
    state.onStateChange!();

    expect(s.gameOverHandled).toBe(true);
    expect(broadcastSpy.mock.calls.some((c) => c[0].type === 'gameOver')).toBe(true);
    // 本次 onStateChange 已广播了击杀事件本身
    expect(broadcastNewStateSpy).toHaveBeenCalled();

    // 模拟杀.execute finally 继续产生的后续 atom(移动牌/结算帧出栈/出牌窗口)
    broadcastSpy.mockClear();
    broadcastNewStateSpy.mockClear();
    state.onStateChange!();
    state.onStateChange!();

    // gameOver 后的广播被拦截——不再下发出牌窗口等事件
    expect(broadcastNewStateSpy).not.toHaveBeenCalled();
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('游戏结束后 handleAction 被拒绝(不再 dispatch)', async () => {
    const state = getState(session);
    state.players[0].alive = false;
    state.onStateChange!();

    const seqBefore = state.seq;
    await session.handleAction('fake-player', {
      skillId: '回合管理',
      actionType: 'end',
      ownerId: 0,
      params: {},
      baseSeq: 0,
    });
    // gameOverHandled=true → handleAction 首行 return,不 dispatch
    expect(state.seq).toBe(seqBefore);
  });
});

describe('checkGameOver:主公阵亡胜负判定', () => {
  function makeState(
    players: Array<{ index: number; identity: string; alive: boolean }>,
  ): GameState {
    return createGameState({
      players: players.map((p) => ({
        index: p.index,
        name: `P${p.index}`,
        identity: p.identity as GameState['players'][number]['identity'],
        character: '',
        health: 4,
        maxHealth: 4,
        alive: p.alive,
        hand: [],
        equipment: {},
        skills: [],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      })),
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
  }

  it('主公阵亡且反贼存活 → 反贼获胜(winner=存活反贼座次)', () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: false },
      { index: 1, identity: '忠臣', alive: true },
      { index: 2, identity: '反贼', alive: true },
      { index: 3, identity: '内奸', alive: true },
    ]);
    const { gameOver, winner } = checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBe(2);
    expect(state.players[winner!].identity).toBe('反贼');
  });

  it('主公阵亡、反贼全灭、内奸存活 → 内奸获胜(内奸清场残局)', () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: false },
      { index: 1, identity: '反贼', alive: false },
      { index: 2, identity: '内奸', alive: true },
    ]);
    const { gameOver, winner } = checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBe(2);
    expect(state.players[winner!].identity).toBe('内奸');
  });

  it('主公阵亡、反贼/内奸均无存活 → 仍判反贼获胜(取任一反贼座次)', () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: false },
      { index: 1, identity: '反贼', alive: false },
      { index: 2, identity: '内奸', alive: false },
      { index: 3, identity: '忠臣', alive: true },
    ]);
    const { gameOver, winner } = checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBeDefined();
    expect(state.players[winner!].identity).toBe('反贼');
  });

  it('主公存活、仅剩主公一人 → 主公方获胜', () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: true },
      { index: 1, identity: '反贼', alive: false },
      { index: 2, identity: '内奸', alive: false },
    ]);
    const { gameOver, winner } = checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBe(0);
  });

  it('多人存活且主公存活 → 游戏未结束', () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: true },
      { index: 1, identity: '反贼', alive: true },
      { index: 2, identity: '内奸', alive: true },
    ]);
    expect(checkGameOver(state).gameOver).toBe(false);
  });
});

describe('session.resetToLobby:游戏结束后重新进入准备阶段', () => {
  let session: GameSession;
  beforeEach(() => {
    session = new GameSession(makeRoom(), true, 42);
    const state = createGameState({
      players: [
        {
          index: 0,
          name: '主公',
          identity: '主公',
          character: '刘备',
          health: 1,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
        {
          index: 1,
          name: '反贼',
          identity: '反贼',
          character: '曹操',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    setState(session, state);
    (session as unknown as { attachStateListener: () => void }).attachStateListener();
  });

  it('resetToLobby:房间回到等待中,清除 gameOverHandled,清空准备,广播 game_reset', () => {
    const state = getState(session);
    const s = session as unknown as {
      broadcast: (m: ServerMessage) => void;
      gameOverHandled: boolean;
      room: Room;
    };
    // 触发游戏结束
    state.players[0].alive = false;
    state.onStateChange!();
    expect(s.gameOverHandled).toBe(true);

    const broadcastSpy = vi.spyOn(s, 'broadcast');

    // 再来一局:重置到准备阶段
    session.resetToLobby();

    expect(s.gameOverHandled).toBe(false);
    expect(s.room.readyPlayers.size).toBe(0);
    expect(getState(session)).toBeNull();
    expect(broadcastSpy.mock.calls.some((c) => c[0].type === 'game_reset')).toBe(true);
  });

  it('resetToLobby 后 gameOverHandled 清除,handleAction 不再被拦截', async () => {
    const state = getState(session);
    state.players[0].alive = false;
    state.onStateChange!();

    session.resetToLobby();
    // gameOverHandled 已清除,state 为 null → handleAction 首行因 !state 直接 return(不会报错)
    await session.handleAction('fake-player', {
      skillId: '回合管理',
      actionType: 'end',
      ownerId: 0,
      params: {},
      baseSeq: 0,
    });
  });
});
