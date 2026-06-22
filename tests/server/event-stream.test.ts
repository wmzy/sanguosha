import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';

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

describe('全局 CAS 删除', () => {
  let session: GameSession;
  beforeEach(() => { resetForTest(); session = new GameSession(makeRoom(), true, 42); });

  it('陈旧 baseSeq 的主动 action 不再被 CAS 拒绝', async () => {
    await session.startGame(4);
    const state = getState(session);
    // 等选将完成
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);
    const lordSlot = [...state.pendingSlots.values()][0].atom as { target: number; candidates: Array<{ name: string }> };
    await session.handleAction('p0', {
      skillId: '系统规则', actionType: '选将', ownerId: lordSlot.target,
      params: { character: lordSlot.candidates[0].name }, baseSeq: state.seq,
    });
    for (let i = 0; i < 100 && state.pendingSlots.size !== 3; i++) await sleep(10);
    const others = [...state.pendingSlots.keys()];
    for (const t of others) {
      const slot = state.pendingSlots.get(t)!;
      const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates[0];
      await session.handleAction('p' + t, {
        skillId: '系统规则', actionType: '选将', ownerId: t,
        params: { character: cand.name }, baseSeq: state.seq,
      });
      await sleep(50);
    }
    for (let i = 0; i < 200 && state.pendingSlots.size > 0; i++) await sleep(10);

    // 等待进入 player 0 的出牌阶段(bootstrap 完成后回合管理自动推进到出牌)
    for (let i = 0; i < 300 && (state.currentPlayerIndex !== 0 || state.phase !== '出牌' || state.pendingSlots.size > 0); i++) await sleep(10);

    // 用陈旧 baseSeq 发主动 action——不应被 CAS 拒(CAS 已删)
    const veryStaleSeq = state.seq - 10;
    const seqBefore = state.seq;
    await session.handleAction('p0', {
      skillId: '回合管理', actionType: 'end', ownerId: 0,
      params: {}, baseSeq: veryStaleSeq,
    });
    await sleep(200);
    // CAS 删除后：action 被接受 → seq 推进
    expect(state.seq).toBeGreaterThan(seqBefore);
  }, 15000);
});
