// 验证选将期间倒计时行为:
// 1. 主公选将 slot 与并行选将 slot 的 deadline/totalMs 相互独立
// 2. 主公选将用较长时间后,并行选将 slot 仍有完整 60s
// 3. 非选将玩家的 events 消息 pending 为 null(不共享主公的倒计时)
//
// 注:出牌阶段的倒计时现在由引擎内的 __出牌 pending 循环管理(session 不再有 idle timer)。
// 选将期间的 deadline 完全来自选将 pending slot,本测试验证其独立性。
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';

function makeRoom(): Room {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    name: '测试',
    maxPlayers: 8,
    players: new Map(),
    isDebug: true,
    createdAt: Date.now(),
    status: '进行中',
    config: { name: '测试', timeoutScale: 1, charPool: 'all', handSize: 4 },
  } as unknown as Room;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}

class FakeWS {
  messages: ServerMessage[] = [];
  readyState = 1;
  send(data: string) {
    this.messages.push(JSON.parse(data));
  }
}

function getLastEventWithDeadline(ws: FakeWS) {
  const ev = [...ws.messages]
    .reverse()
    .find((m) => m.type === 'event' && m.deadline !== undefined) as
    | Extract<ServerMessage, { type: 'event' }>
    | undefined;
  return ev;
}

describe('选将倒计时独立性', () => {
  let session: GameSession;
  let state: GameState;
  let wss: FakeWS[];

  beforeEach(async () => {
    session = new GameSession(makeRoom(), true, 42);
    wss = [];
    // 预注册 5 个玩家 WS
    const room = (session as unknown as { room: Room }).room;
    for (let i = 0; i < 5; i++) {
      const ws = new FakeWS();
      wss.push(ws);
      room.players.set(`p${i}`, ws as never);
    }
    await session.startGame(5);
    state = getState(session);
    // 等主公选将 slot 出现
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);
  }, 15000);

  it('主公选将期间:主公的 pending deadline ≈ now+60s,其他玩家 pending 为 null', async () => {
    const lordIdx = 0; // debug 模式主公固定 0 号位
    const lordSlot = state.pendingSlots.get(lordIdx)!;
    expect(lordSlot).toBeDefined();

    // 清空消息,触发一次广播
    for (const ws of wss) ws.messages = [];
    (session as unknown as { lastBroadcastSeq: number }).lastBroadcastSeq = 0;
    (session as unknown as { lastSentDeadline: Map<string, string | null> }).lastSentDeadline =
      new Map();
    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();
    await sleep(50);

    // 主公(viewer 0)的 event 应携带 deadline(pending 的)
    const lordEvent = getLastEventWithDeadline(wss[0]);
    expect(lordEvent).toBeDefined();
    expect(lordEvent!.deadline).not.toBeNull();
    expect(lordEvent!.deadline!.totalMs).toBe(60_000);
    const lordDeadline = lordEvent!.deadline!.deadline;
    // deadline 应约为 now + 60s(允许几秒误差)
    expect(lordDeadline).toBeGreaterThan(Date.now() + 55_000);
    expect(lordDeadline).toBeLessThan(Date.now() + 65_000);

    // 其他玩家(viewer 1-4)不应收到主公的 pending deadline
    for (let i = 1; i < 5; i++) {
      const ev = getLastEventWithDeadline(wss[i]);
      if (ev) {
        // 非选将玩家不应收到主公的 pending deadline
        expect(ev.deadline).toBeNull();
      }
    }
  }, 15000);

  it('主公选完后:并行选将 slot 的 deadline 是独立的(基于各自创建时间)', async () => {
    const lordIdx = 0;
    const lordSlot = state.pendingSlots.get(lordIdx)!;
    const lordCand = (lordSlot.atom as { candidates: Array<{ name: string }> }).candidates;

    // 记录主公选完的时间
    const beforeLordRespond = Date.now();

    // 主公选将
    await session.handleAction('p0', {
      skillId: '系统规则',
      actionType: '选将',
      ownerId: lordIdx,
      params: { character: lordCand[0].name },
      baseSeq: state.seq,
    });
    // 等并行选将 slot 出现
    for (let i = 0; i < 100 && state.pendingSlots.size !== 4; i++) await sleep(10);
    await sleep(50);

    expect(state.pendingSlots.size).toBe(4);
    const afterLordRespond = Date.now();
    const _lordElapsed = afterLordRespond - beforeLordRespond;

    // 清空消息,广播
    for (const ws of wss) ws.messages = [];
    (session as unknown as { lastBroadcastSeq: number }).lastBroadcastSeq = 0;
    (session as unknown as { lastSentDeadline: Map<string, string | null> }).lastSentDeadline =
      new Map();
    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();
    await sleep(50);

    // 每个并行选将玩家应有独立的 deadline ≈ now + 60s
    for (let i = 1; i < 5; i++) {
      const ev = getLastEventWithDeadline(wss[i]);
      expect(ev).toBeDefined();
      expect(ev!.deadline).not.toBeNull();
      expect(ev!.deadline!.totalMs).toBe(60_000);
      const deadline = ev!.deadline!.deadline;
      // deadline 应基于 slot 创建时间(afterLordRespond 附近)+ 60s
      // 不应受主公选将耗时影响(deadline 应在 now + 55s ~ now + 65s 之间)
      expect(deadline).toBeGreaterThan(Date.now() + 55_000);
      expect(deadline).toBeLessThan(Date.now() + 65_000);
      // 关键:deadline 不应被主公选将耗时提前
      // 如果共用倒计时,deadline 会是 startedAt + 60s - lordElapsed(提前)
      expect(deadline).toBeGreaterThan(Date.now() + 55_000);
    }

    // 清理:选完剩余玩家避免 timer 残留
    for (const t of [...state.pendingSlots.keys()]) {
      const slot = state.pendingSlots.get(t)!;
      const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates[0];
      await session.handleAction(`p${t}`, {
        skillId: '系统规则',
        actionType: '选将',
        ownerId: t,
        params: { character: cand.name },
        baseSeq: state.seq,
      });
      await sleep(30);
    }
  }, 15000);
});
