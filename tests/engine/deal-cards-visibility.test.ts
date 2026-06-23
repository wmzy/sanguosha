// tests/engine/deal-cards-visibility.test.ts
// 验证开局发牌后,玩家能通过事件流看到自己的初始手牌。
//
// Bug 根因:发牌 atom 缺少 toViewEvents,走 fallback(原始 atom,不含 cards)。
// applyView 也只更新 handCount,不更新 hand 数组。导致玩家在事件流模式下
// 只能看到手牌数量,看不到牌面。
//
// 修复后:发牌 atom 实现 toViewEvents(信息分级:owner 看 cards,others 看数量)
// 且 applyView 更新 owner 的 hand 数组。
import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';

function makeRoom(): Room {
  return {
    id: 'test-' + Math.random().toString(36).slice(2, 8),
    name: '测试', maxPlayers: 4, players: new Map(),
    isDebug: true, createdAt: Date.now(), status: '进行中',
  } as unknown as Room;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}

class FakeWS {
  messages: ServerMessage[] = [];
  readyState = 1; // OPEN
  send(data: string) { this.messages.push(JSON.parse(data)); }
}

/** 从 FakeWS 收到的消息中提取所有 event 的 view */
function allViews(ws: FakeWS): { seq: number; view: import('../../src/engine/types').ViewEvent }[] {
  const out: { seq: number; view: import('../../src/engine/types').ViewEvent }[] = [];
  for (const msg of ws.messages) {
    if (msg.type === 'event') {
      out.push({ seq: msg.seq, view: msg.view });
    }
  }
  return out;
}

describe('发牌可见性:玩家应看到自己的初始手牌', () => {
  let session: GameSession;
  let state: GameState;

  beforeEach(async () => {
    resetForTest();
    session = new GameSession(makeRoom(), true, 42);
  });

  it('事件流中包含发牌的 cards 字段(每玩家各自的手牌)', async () => {
    await session.startGame(2);
    state = getState(session);

    // 挂两个 FakeWS 模拟两个玩家连接
    const ws0 = new FakeWS();
    const ws1 = new FakeWS();
    (session as any).room.players.set('p0', ws0 as any);
    (session as any).room.players.set('p1', ws1 as any);
    (session as any).playerNames.set('p0', 0);
    (session as any).playerNames.set('p1', 1);

    // 等选将 pending 出现
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);

    // 主公选将
    const lordSlot = [...state.pendingSlots.values()][0];
    const lordAtom = lordSlot.atom as { target: number; candidates: Array<{ name: string }> };
    await session.handleAction('p' + lordAtom.target, {
      skillId: '系统规则', actionType: '选将', ownerId: lordAtom.target,
      params: { character: lordAtom.candidates[0].name }, baseSeq: state.seq,
    });
    // 等另一个玩家选将 pending 出现
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);
    // 非主公选将
    const otherSlots = [...state.pendingSlots.keys()];
    for (const t of otherSlots) {
      const slot = state.pendingSlots.get(t)!;
      const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates[0];
      await session.handleAction('p' + t, {
        skillId: '系统规则', actionType: '选将', ownerId: t,
        params: { character: cand.name }, baseSeq: state.seq,
      });
      await sleep(50);
    }
    // 等 bootstrap 完成(发牌 + 回合推进)
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(300);

    // 引擎真实 state:玩家应该有手牌
    const realHand0 = state.players[0].hand;
    expect(realHand0.length).toBeGreaterThanOrEqual(4);

    // 从 p0 收到的 event 中找发牌事件
    const views0 = allViews(ws0);
    const dealEvents0 = views0.filter(e => e.view?.type === '发牌');
    expect(dealEvents0.length).toBe(1);
    const dealCards0 = dealEvents0[0].view?.cards as unknown[] | undefined;
    expect(dealCards0).toBeDefined();
    expect(dealCards0!.length).toBeGreaterThanOrEqual(4);

    // 从 p1 收到的 event 中找发牌事件
    const views1 = allViews(ws1);
    const dealEvents1 = views1.filter(e => e.view?.type === '发牌');
    expect(dealEvents1.length).toBe(1);
    const dealCards1 = dealEvents1[0].view?.cards as unknown[] | undefined;
    expect(dealCards1).toBeDefined();
    expect(dealCards1!.length).toBeGreaterThanOrEqual(4);
  }, 20000);
});
