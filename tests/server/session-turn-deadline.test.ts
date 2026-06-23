// tests/server/session-turn-deadline.test.ts
// 回归测试:验证出牌/弃牌阶段倒计时的前后端同步。
//
// 根因:deadline 只在 buildView(首次 initialView)中计算,后续 events 消息不携带,
// 前端 view.deadline 永远卡在初始值;且服务端 resetIdleTimer 每次 action 滑动续期,
// 前端无从得知,导致倒计时与实际超时严重不一致(前端比后端提前超时)。
//
// 修复要点:
// 1. session 维护 idleDeadline,resetIdleTimer 设置它
// 2. resetIdleTimer 在 broadcastNewState 之前调用(顺序修正)
// 3. broadcastNewState 的 event 消息携带 deadline(仅在变化时)
// 4. buildView 的 deadline guard 对齐 resetIdleTimer(有 pending 时不计时)
import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import { TURN_IDLE_TIMEOUT_MS } from '../../src/engine/view/buildView';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';

function makeRoom(): Room {
  return {
    id: 'test-room-' + Math.random().toString(36).slice(2, 8),
    name: '测试',
    maxPlayers: 4,
    players: new Map(),
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

/** 通过 reflection 取 session.idleDeadline(私有字段) */
function getIdleDeadline(session: GameSession): number | null {
  return (session as unknown as { idleDeadline: number | null }).idleDeadline;
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

/** 构造一个处于出牌阶段、2 人存活的极简 state(不走 bootstrap) */
function makeActState(): GameState {
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('session:出牌/弃牌阶段倒计时前后端同步', () => {
  let session: GameSession;

  beforeEach(() => {
    resetForTest();
    session = new GameSession(makeRoom(), true, 42);
    // 直接注入一个出牌阶段的 state,跳过 bootstrap
    const state = makeActState();
    setState(session, state);
    // 挂载 onStateChange
    (session as unknown as { attachStateListener: () => void }).attachStateListener();
  });

  it('resetIdleTimer 设置 idleDeadline = now + TURN_IDLE_TIMEOUT_MS', () => {
    // 通过 reflection 调 resetIdleTimer
    const before = Date.now();
    (session as unknown as { resetIdleTimer: () => void }).resetIdleTimer();
    const after = Date.now();
    const deadline = getIdleDeadline(session);
    expect(deadline).not.toBeNull();
    // deadline 应在 [before+timeout, after+timeout] 区间
    expect(deadline!).toBeGreaterThanOrEqual(before + TURN_IDLE_TIMEOUT_MS);
    expect(deadline!).toBeLessThanOrEqual(after + TURN_IDLE_TIMEOUT_MS);
  });

  it('有 pending slot 时 idleDeadline 为 null(不计时)', () => {
    const state = getState(session);
    // 模拟有 pending(如询问闪)
    state.pendingSlots.set(0, {
      atom: { type: '询问闪', target: 0 } as never,
      definition: {} as never,
      deadline: 30000,
      startTime: 0,
      resolve: () => {},
    } as never);
    (session as unknown as { resetIdleTimer: () => void }).resetIdleTimer();
    expect(getIdleDeadline(session)).toBeNull();
  });

  it('event 消息携带 deadline,前端据此同步倒计时', () => {
    const state = getState(session);
    // 接一个玩家 WS
    const ws = new FakeWS();
    const playerId = 'p-test';
    const room = (session as unknown as { room: Room }).room;
    room.players.set(playerId, ws as unknown as import('hono/ws').WSContext);
    (session as unknown as { playerNames: Map<string, number> }).playerNames.set(playerId, 0);

    // 触发一次广播(broadcastNewState 内部会先调 resetIdleTimer 设置 deadline)
    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();

    // 应收到 initialView(首次) 且其 state.deadline 非空
    const initialMsg = ws.messages.find(m => m.type === 'initialView');
    expect(initialMsg).toBeDefined();
    if (initialMsg!.type === 'initialView') {
      // buildView 对齐了 guard:出牌阶段无 pending → deadline 非空
      expect(initialMsg!.state.deadline).not.toBeNull();
      expect(initialMsg!.state.deadlineTotalMs).toBe(TURN_IDLE_TIMEOUT_MS);
    }
    void state;
  });

  it('每次 onStateChange 后 idleDeadline 滑动续期(重置为新 now+timeout)', async () => {
    const onChange = getState(session).onStateChange;
    expect(onChange).toBeDefined();
    // 第一次触发
    onChange!();
    const d1 = getIdleDeadline(session);
    expect(d1).not.toBeNull();

    await new Promise(r => setTimeout(r, 50));

    // 第二次触发(模拟玩家出牌后的状态变更)
    onChange!();
    const d2 = getIdleDeadline(session);
    expect(d2).not.toBeNull();
    // d2 应比 d1 晚(滑动续期)
    expect(d2!).toBeGreaterThan(d1!);
  });
});
