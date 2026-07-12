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
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';
import type { ConnectionSink } from '../../src/server/connection';

function makeRoom(): Room {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    name: '测试',
    maxPlayers: 4,
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

class FakeSink implements ConnectionSink {
  messages: ServerMessage[] = [];
  send(message: ServerMessage): void {
    this.messages.push(message);
  }

  close(): void {}
  get isAlive(): boolean {
    return true;
  }
}

/** 从 FakeSink 收到的消息中提取所有 event 的 view */
function allViews(sink: FakeSink): { seq: number; view: import('../../src/engine/types').ViewEvent }[] {
  const out: { seq: number; view: import('../../src/engine/types').ViewEvent }[] = [];
  for (const msg of sink.messages) {
    if (msg.type === 'event' && msg.view) {
      out.push({ seq: msg.seq, view: msg.view });
    }
  }
  return out;
}

describe('发牌可见性:玩家应看到自己的初始手牌', () => {
  let session: GameSession;
  let state: GameState;

  beforeEach(async () => {
    session = new GameSession(makeRoom(), true, 42);
  });

  it('事件流中包含发牌的 cards 字段(每玩家各自的手牌)', async () => {
    await session.startGame(2);
    state = getState(session);

    // 挂两个 FakeSink 模拟两个玩家连接
    const sink0 = new FakeSink();
    const sink1 = new FakeSink();
    (session as any).room.players.set('p0', sink0);
    (session as any).room.players.set('p1', sink1);
    (session as any).playerNames.set('p0', 0);
    (session as any).playerNames.set('p1', 1);

    // 确定性驱动 bootstrap 完成(选将 → 发牌):
    // bootstrap 是 fire-and-forget,选将时序为「主公串行 + 非主公并行」,在 vitest
    // 全量并发下事件循环被挤压,固定次数的 sleep 轮询窗口会被耗尽(原 flaky 根因)。
    // 改用墙钟超时循环:持续响应任何出现的选将 pending,直到发牌的直接信号
    // (手牌非空)出现,彻底消除时序竞态。
    const deadline = Date.now() + 8000;
    let bootstrapDone = false;
    while (Date.now() < deadline) {
      for (const [t, slot] of [...state.pendingSlots]) {
        const atom = slot.atom as { type: string; candidates?: Array<{ name: string }> };
        const isCharSelect = atom.type === '选将询问' && Array.isArray(atom.candidates);
        // 纵深防御:已选将的玩家不再响应(引擎层也会拒,这里提前避免无效 dispatch)
        if (isCharSelect && !state.players[t]?.character) {
          await session.handleAction(`p${t}`, {
            skillId: '系统规则',
            actionType: '选将',
            ownerId: t,
            params: { character: atom.candidates![0].name },
            baseSeq: state.seq,
          });
        }
      }
      if ((state.players[0]?.hand?.length ?? 0) >= 4) {
        bootstrapDone = true;
        break;
      }
      await sleep(20);
    }
    // 明确断言:bootstrap 必须完成发牌,否则后续 dealEvents 断言无意义
    expect(bootstrapDone, 'bootstrap 未在超时内完成发牌(选将/发牌时序异常)').toBe(true);
    expect(state.players[0].hand.length).toBeGreaterThanOrEqual(4);

    // 从 p0 收到的 event 中找发牌事件
    const views0 = allViews(sink0);
    const dealEvents0 = views0.filter((e) => e.view?.type === '发牌');
    expect(dealEvents0.length).toBe(1);
    const dealCards0 = dealEvents0[0].view?.cards as unknown[] | undefined;
    expect(dealCards0).toBeDefined();
    expect(dealCards0!.length).toBeGreaterThanOrEqual(4);

    // 从 p1 收到的 event 中找发牌事件
    const views1 = allViews(sink1);
    const dealEvents1 = views1.filter((e) => e.view?.type === '发牌');
    expect(dealEvents1.length).toBe(1);
    const dealCards1 = dealEvents1[0].view?.cards as unknown[] | undefined;
    expect(dealCards1).toBeDefined();
    expect(dealCards1!.length).toBeGreaterThanOrEqual(4);
  }, 20000);
});
