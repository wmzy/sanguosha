// tests/server/session-cas-respond.test.ts
// 验证 session.handleAction 的行为:
// 1. respond 路径(该 ownerId 有 pending slot)始终被接受(并行选将不卡死)。
// 2. 全局 CAS 已删除:主动 action 不再因陈旧 baseSeq 被静默丢弃。
//
// 核心场景:并行选将时多个玩家同时 respond,state.seq 连续 +1,
// 后发的 respond 基于旧 lastSeq 仍能被引擎 validate 接受。
//
// 测试通过 reflection 访问 session.state(私有),用真实 dispatch 路径验证。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import { deletePersistedRoom } from '../../src/server/persistence';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';

// 跟踪本文件创建的房间 id,afterEach 清理持久化文件,避免 data/rooms/ 残留
// 被下次 dev server 启动恢复成僵尸 session。
const trackedRoomIds: string[] = [];
afterEach(async () => {
  await Promise.all(
    trackedRoomIds.splice(0).map((id) => deletePersistedRoom(id).catch(() => {})),
  );
});

function makeRoom(): Room {
  const room: Room = {
    id: `test-room-${Math.random().toString(36).slice(2, 8)}`,
    name: '测试',
    maxPlayers: 4,
    players: new Map(),
    isDebug: true,
    createdAt: Date.now(),
    status: '进行中',
    config: { name: '测试', timeoutScale: 1, charPool: 'all', handSize: 4 },
    spectators: new Map(),
    viewGrants: new Map(),
    pendingViewRequests: new Map(),
  } as unknown as Room;
  trackedRoomIds.push(room.id);
  return room;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 通过 reflection 取 session.state(私有字段) */
function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}

describe('session.handleAction:CAS 删除后 respond/主动 action 均被接受', () => {
  let session: GameSession;

  beforeEach(() => {
    session = new GameSession(makeRoom(), true, 42);
  });

  it('并行选将中,基于陈旧 baseSeq 的 respond 仍被接受(不卡到超时)', async () => {
    // 启动游戏(走完整 debug 流程)
    await session.startGame(4);
    const state = getState(session);
    expect(state).toBeDefined();

    // 等主公选将 slot 出现
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);
    expect(state.pendingSlots.size).toBe(1);
    const lordSlotAtom = [...state.pendingSlots.values()][0].atom as {
      target: number;
      candidates: Array<{ name: string }>;
    };
    const lordTarget = lordSlotAtom.target;
    const lordCandidates = lordSlotAtom.candidates;

    // 主公 respond(baseSeq 是当前 seq,正常通过 CAS)
    await session.handleAction('p0', {
      skillId: '系统规则',
      actionType: '选将',
      ownerId: lordTarget,
      params: { character: lordCandidates[0].name },
      baseSeq: state.seq,
    });
    for (let i = 0; i < 100 && state.pendingSlots.size !== 3; i++) await sleep(10);
    expect(state.pendingSlots.size).toBe(3);
    expect(state.players[lordTarget].character).toBe(lordCandidates[0].name);

    // 关键:所有非主公用【同一个陈旧 baseSeq】并发 respond
    // 模拟真实场景——客户端 lastSeq 更新有延迟,多个玩家可能基于同一个旧 seq 发 action
    const staleBaseSeq = state.seq - 1; // 故意用一个肯定陈旧的值
    const others = [...state.pendingSlots.keys()];
    expect(others.length).toBe(3);

    // 并发调 handleAction
    await Promise.all(
      others.map(async (t) => {
        const slot = state.pendingSlots.get(t);
        if (!slot) return;
        const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates[0];
        await session.handleAction(`p${t}`, {
          skillId: '系统规则',
          actionType: '选将',
          ownerId: t,
          params: { character: cand.name },
          baseSeq: staleBaseSeq,
        });
      }),
    );

    // 等所有 slot resolve
    for (let i = 0; i < 200 && state.pendingSlots.size > 0; i++) await sleep(10);

    // 验证:所有玩家都选完(而不是卡在 pendingSlots.size > 0 等超时)
    expect(state.pendingSlots.size).toBe(0);
    for (const t of others) {
      expect(state.players[t].character).toBeTruthy();
    }
  }, 15000);

  it('主动 action 不再受 CAS 保护:陈旧 baseSeq 被接受', async () => {
    // 等待上一个测试的 fire-and-forget bootstrap 完成
    await sleep(200);
    session = new GameSession(makeRoom(), true, 42);

    // 启动并完成选将
    await session.startGame(4);
    const state = getState(session);
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);

    // 主公选
    const lordSlot2 = [...state.pendingSlots.values()][0].atom as {
      target: number;
      candidates: Array<{ name: string }>;
    };
    const lordTarget = lordSlot2.target;
    const lordCand = lordSlot2.candidates[0];
    await session.handleAction('p0', {
      skillId: '系统规则',
      actionType: '选将',
      ownerId: lordTarget,
      params: { character: lordCand.name },
      baseSeq: state.seq,
    });
    for (let i = 0; i < 100 && state.pendingSlots.size !== 3; i++) await sleep(10);

    // 其它人选
    const others = [...state.pendingSlots.keys()];
    for (const t of others) {
      const slot = state.pendingSlots.get(t)!;
      const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates[0];
      await session.handleAction(`p${t}`, {
        skillId: '系统规则',
        actionType: '选将',
        ownerId: t,
        params: { character: cand.name },
        baseSeq: state.seq,
      });
      await sleep(50);
    }
    for (let i = 0; i < 200 && state.pendingSlots.size > 0; i++) await sleep(10);
    // 选将完成后无阻塞型 pending(出牌阶段会有 __出牌 询问,但不阻塞)
    expect(state.pendingSlots.size <= 1).toBe(true);

    // 等待进入 player 0 的出牌阶段(bootstrap 完成后回合管理自动推进到出牌)
    // 出牌阶段会有 __出牌 询问(非阻塞型 pending),不检查 pendingSlots.size
    // 注:某些角色(如刘禅·放权)在进入出牌阶段前会触发 confirm 询问——
    // 自动拒绝以推进阶段切换。
    for (let i = 0; i < 300 && (state.currentPlayerIndex !== 0 || state.phase !== '出牌'); i++) {
      // 自动拒绝任何阻塞型 confirm 询问(如放权/trigger)
      for (const [t, slot] of state.pendingSlots) {
        if (!slot.isBlocking) continue;
        const atom = slot.atom as { type?: string; requestType?: string; target?: number };
        if (atom.type === '请求回应' && atom.target === t) {
          await session.handleAction(`p${t}`, {
            skillId: atom.requestType?.split('/')[0] ?? '系统规则',
            actionType: 'respond',
            ownerId: t,
            params: { choice: false },
            baseSeq: state.seq,
          });
        }
      }
      await sleep(10);
    }

    // 现在进入游戏,处于出牌阶段。用陈旧 baseSeq 发主动 action
    const veryStaleSeq = state.seq - 10;
    const beforeSeq = state.seq;
    await session.handleAction('p0', {
      skillId: '回合管理',
      actionType: 'end',
      ownerId: 0,
      params: {},
      baseSeq: veryStaleSeq,
    });
    await sleep(200);
    // CAS 删除后:action 被接受 → seq 推进
    expect(state.seq).toBeGreaterThan(beforeSeq);
  }, 15000);
});
