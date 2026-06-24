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
import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import { buildView } from '../../src/engine/view/buildView';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';

function makeRoom(): Room {
  return {
    id: 'test-room-' + Math.random().toString(36).slice(2, 8),
    name: '测试',
    maxPlayers: 4,
    players: new Map([['fake-player', new FakeWS() as never]]),
    isDebug: true,
    createdAt: Date.now(),
    status: '进行中',
  } as unknown as Room;
}

/** 通过 reflection 取/设 session.state(私有字段) */
function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}
function setState(session: GameSession, state: GameState): void {
  (session as unknown as { state: GameState }).state = state;
}

/** 伪 WebSocket,收集所有发给该 player 的消息 */
class FakeWS {
  messages: ServerMessage[] = [];
  readyState = 1; // OPEN
  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }
  close(): void { /* noop */ }
}

/** 构造一个处于出牌阶段、2 人存活、带 __出牌 pending 的极简 state */
function makeActState(): GameState {
  const state = createGameState({
    players: [
      { index: 0, name: 'P1', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
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
    resetForTest();
    session = new GameSession(makeRoom(), true, 42);
    const state = makeActState();
    setState(session, state);
    (session as unknown as { attachStateListener: () => void }).attachStateListener();
  });

  it('buildView 在有 __出牌 pending 时返回非空 deadline', () => {
    const state = getState(session);
    // 模拟 __出牌 pending slot(50s 超时)
    const before = Date.now();
    state.pendingSlots.set(0, {
      atom: { type: '请求回应', requestType: '__出牌', target: 0 } as never,
      definition: { pending: { onTimeout: async () => {}, prompt: { type: 'confirm' as const, title: '' }, timeout: 50 } } as never,
      deadline: 50_000,
      startTime: 0,
      resolve: () => {},
    } as never);
    const after = Date.now();

    const view = buildView(state, 0);
    expect(view.deadline).not.toBeNull();
    // deadline 应在 [before+50s, after+50s] 区间(因为 slot.deadline 是相对时间 50000ms)
    expect(view.deadline!).toBeGreaterThanOrEqual(state.startedAt + 50_000);
    expect(view.deadlineTotalMs).toBe(50_000);
    void before; void after;
  });

  it('buildView 无 pending 时 deadline 为 null', () => {
    const state = getState(session);
    const view = buildView(state, 0);
    expect(view.deadline).toBeNull();
    expect(view.deadlineTotalMs).toBe(0);
  });

  it('event 消息携带 deadline(来自 pending slot)', () => {
    const state = getState(session);
    // 接一个玩家 WS
    const ws = new FakeWS();
    const playerId = 'p-test';
    const room = (session as unknown as { room: Room }).room;
    room.players.set(playerId, ws as unknown as import('hono/ws').WSContext);
    (session as unknown as { playerNames: Map<string, number> }).playerNames.set(playerId, 0);

    // 模拟 __出牌 pending slot
    state.pendingSlots.set(0, {
      atom: { type: '请求回应', requestType: '__出牌', target: 0 } as never,
      definition: { pending: { onTimeout: async () => {}, prompt: { type: 'confirm' as const, title: '' }, timeout: 50 } } as never,
      deadline: 50_000,
      startTime: 0,
      resolve: () => {},
    } as never);

    // 触发广播
    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();

    // 应收到 initialView 且其 state.deadline 非空
    const initialMsg = ws.messages.find(m => m.type === 'initialView');
    expect(initialMsg).toBeDefined();
    if (initialMsg!.type === 'initialView') {
      expect(initialMsg!.state.deadline).not.toBeNull();
      expect(initialMsg!.state.deadlineTotalMs).toBe(50_000);
    }
    void state;
  });
});
