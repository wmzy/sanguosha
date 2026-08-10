// tests/server/restore-replay.test.ts
// 验证 engine.restore 能正确重放含交互式选将的 actionLog。
// 根因:restore 重放循环无等待,fire-and-forget 的开局 execute 还没创建选将 slot 时,
// 选将 respond 的 validate 因 pendingSlots 为空被拒 → 选将 slot 永久挂起 → 重启后回到选将。
// 修复:restore 重放加 settle 同步,等 execute 到达挂起点(slot 创建)再发下一条 action。
// 归并建议:未来持久化恢复测试统一后,可与 tests/server/persistence.test.ts 合并。
import { describe, it, expect, afterEach } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { bootstrap, dispatch, restore, fireTimeout, type GameConfig } from '../../src/engine/index';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';
import { allCharacters } from '../../src/engine/data/characters';
import { GameSession } from '../../src/server/session';
import { deletePersistedRoom } from '../../src/server/persistence';
import type { Room } from '../../src/server/room';

const CHARACTERS = allCharacters.map((c) => ({
  name: c.name,
  skills: c.skills.map((s) => s.name),
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeState(playerCount: number): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    index: i,
    name: `P${i + 1}`,
    character: '',
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
  }));
  const state = createGameState({ players, cardMap: {} });
  for (let i = 0; i < 60; i++) {
    const id = `deck_${i}`;
    state.cardMap[id] = { id, name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
    state.zones.deck.push(id);
  }
  return state;
}

function makeConfig(playerCount: number): GameConfig {
  return {
    characters: CHARACTERS,
    playerCount,
    seed: 42,
    gameId: 'restore-test',
    handSize: 4,
  };
}

/** 驱动一局完整的交互式选将,记录选将 respond 的 actionLog。
 *  返回 actionLog(含开局 start + 选将 respond)。 */
async function playThroughCharSelect(state: GameState, config: GameConfig): Promise<void> {
  void bootstrap(state, config);
  // 等主公选将 slot
  for (let i = 0; i < 200 && state.pendingSlots.size === 0; i++) await sleep(10);

  // 主公选将
  const lordSlot = [...state.pendingSlots.values()][0];
  const lordAtom = lordSlot.atom as { target: number; candidates: Array<{ name: string }> };
  void dispatch(state, {
    skillId: '系统规则',
    actionType: '选将',
    ownerId: lordAtom.target,
    params: { character: lordAtom.candidates[0].name },
    baseSeq: state.seq,
  });
  // 等并行选将 slot
  for (let i = 0; i < 200 && state.pendingSlots.size < config.playerCount - 1; i++)
    await sleep(10);

  // 并行选将(轮询驱动,模拟现有测试的 fire-and-forget 时序)
  for (const t of [...state.pendingSlots.keys()]) {
    const slot = state.pendingSlots.get(t)!;
    const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates[0];
    void dispatch(state, {
      skillId: '系统规则',
      actionType: '选将',
      ownerId: t,
      params: { character: cand.name },
      baseSeq: state.seq,
    });
    await sleep(30);
  }
  // 等所有选将 slot 清空
  for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
}

// ── session 层 harness(模拟服务端重启) ──
function makeRoom(): Room {
  return {
    id: `test-restore-${Math.random().toString(36).slice(2, 8)}`,
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
    hostId: null,
    readyPlayers: new Set(),
    roomType: 'normal',
    chatHistory: [],
    seats: [null, null, null, null],
    pendingSeatSwaps: new Map(),
  } as unknown as Room;
}
function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}

const trackedRoomIds: string[] = [];
afterEach(async () => {
  await Promise.all(
    trackedRoomIds.splice(0).map((id) => deletePersistedRoom(id).catch(() => {})),
  );
});

/** 通过 GameSession 驱动完整的交互式选将(模拟正常开局)。 */
async function driveCharSelectViaSession(
  session: GameSession,
  state: GameState,
  playerCount: number,
): Promise<void> {
  for (let i = 0; i < 200 && state.pendingSlots.size === 0; i++) await sleep(10);
  // 主公选将
  const lordSlot = [...state.pendingSlots.values()][0];
  const lordAtom = lordSlot.atom as { target: number; candidates: Array<{ name: string }> };
  await session.handleAction('p0', {
    skillId: '系统规则',
    actionType: '选将',
    ownerId: lordAtom.target,
    params: { character: lordAtom.candidates[0].name },
    baseSeq: state.seq,
  });
  // 等并行选将 slot
  for (let i = 0; i < 200 && state.pendingSlots.size < playerCount - 1; i++) await sleep(10);
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
  for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
}

describe('restore 重放交互式选将 actionLog', () => {
  it('restore 后选将完成,不卡在选将 pending,武将与原对局一致', async () => {
    // ── 第一局:完整选将,记录 actionLog + 武将选择 ──
    const config = makeConfig(4);
    const state1 = makeState(4);
    await playThroughCharSelect(state1, config);

    // 第一局选将应已完成
    expect(state1.players.every((p) => p.character)).toBe(true);
    const expectedChars = state1.players.map((p) => p.character);
    const actionLog = state1.actionLog.map((e) => ({ ...e }));
    // actionLog 至少含:开局 start + 主公选将 + 3 个并行选将 = 5 条
    expect(actionLog.length).toBeGreaterThanOrEqual(5);

    // ── 第二局:create(已在 makeState)→ bootstrap → restore 重放 ──
    const state2 = makeState(4);
    await bootstrap(state2, config);
    await restore(state2, config, actionLog);

    // ── 核心断言 1:选将完成(所有玩家都有武将) ──
    expect(state2.players.every((p) => p.character)).toBe(true);

    // ── 核心断言 2:确定性重放,武将与第一局一致 ──
    expect(state2.players.map((p) => p.character)).toEqual(expectedChars);

    // ── 核心断言 3(根因症状):不卡在选将询问 pending ──
    const hasSelectPending = [...state2.pendingSlots.values()].some(
      (s) => (s.atom as { type?: string }).type === '选将询问',
    );
    expect(hasSelectPending).toBe(false);
  }, 30000);

  it('restore 重放出杀+超时(fireTimeout)后状态一致,无 isBlocking pending 堆积', async () => {
    // 根因:fireTimeout(超时不出闪/不发动被动技 → 扣血/弃牌)不记录在 actionLog。
    // 旧实现重放出杀 use 后创建询问闪 pending,settleExecute 过早返回,pending 不 resolve → 堆积 OOM。
    // v3 修复:fireTimeout 不被剩余 actionLog respond 的 isBlocking pending,等 execute resume 完成。
    const config = makeConfig(4);
    const state1 = makeState(4);
    await playThroughCharSelect(state1, config);
    // 等出牌窗口
    for (let i = 0; i < 300 && state1.pendingSlots.size === 0; i++) await sleep(10);
    const playSlot = [...state1.pendingSlots.values()].find(
      (s) => (s.atom as { type?: string }).type === '出牌窗口',
    );
    expect(playSlot).toBeTruthy();
    const attacker = (playSlot!.atom as { player: number }).player;
    const killCard = state1.players[attacker].hand.find(
      (id) => state1.cardMap[id]?.name === '杀',
    );
    expect(killCard).toBeTruthy();
    void dispatch(state1, {
      skillId: '杀',
      actionType: 'use',
      ownerId: attacker,
      params: { cardId: killCard!, targets: [(attacker + 1) % 4] },
      baseSeq: state1.seq,
    });
    // 等询问(闪/请求回应)出现
    for (
      let i = 0;
      i < 300 &&
      [...state1.pendingSlots.values()].every(
        (s) => (s.atom as { type?: string }).type === '出牌窗口',
      );
      i++
    )
      await sleep(10);
    // fireTimeout 所有 isBlocking pending(超时不出闪/不发动被动技)
    await fireTimeout(state1);
    // 等出杀 execute resume 完成回到出牌窗口
    for (let i = 0; i < 300; i++) {
      await sleep(10);
      if (
        [...state1.pendingSlots.values()].some(
          (s) => (s.atom as { type?: string }).type === '出牌窗口',
        )
      )
        break;
    }
    const origSeq = state1.seq;
    const origHealth = state1.players.map((p) => p.health);
    const actionLog = state1.actionLog.map((e) => ({ ...e }));

    // 第二局:create + bootstrap + restore 重放
    const state2 = makeState(4);
    await bootstrap(state2, config);
    await restore(state2, config, actionLog);

    // 状态一致(核心:fireTimeout 副作用不在 actionLog,但 v3 主动 fireTimeout 推进)
    expect(state2.seq).toBe(origSeq);
    expect(state2.players.map((p) => p.health)).toEqual(origHealth);
    // 无残留 isBlocking pending(防 OOM)
    const blockingSlots = [...state2.pendingSlots.values()].filter((s) => s.isBlocking);
    expect(blockingSlots.length).toBe(0);
  }, 30000);
});

describe('session.restoreState 端到端(模拟服务端重启)', () => {
  it('重启后重放 actionLog,选将完成且不卡选将,武将与原对局一致', async () => {
    const room = makeRoom();
    trackedRoomIds.push(room.id);

    // ── session1:正常开局 + 交互式选将 ──
    const session1 = new GameSession(room, true, 42);
    await session1.startGame(4);
    const state1 = getState(session1);
    await driveCharSelectViaSession(session1, state1, 4);

    // 选将完成
    expect(state1.players.every((p) => p.character)).toBe(true);
    const expectedChars = state1.players.map((p) => p.character);
    const actionLog = session1.getGameLog()!.map((e) => ({ ...e }));
    expect(actionLog.length).toBeGreaterThanOrEqual(5);

    // ── session2:模拟服务端重启,用 state + actionLog 恢复 ──
    const session2 = new GameSession(room, true);
    await session2.restoreState(state1, actionLog);
    const state2 = getState(session2);

    // ── 核心断言 1:选将完成 ──
    expect(state2.players.every((p) => p.character)).toBe(true);

    // ── 核心断言 2:确定性重放,武将一致 ──
    expect(state2.players.map((p) => p.character)).toEqual(expectedChars);

    // ── 核心断言 3(用户报告的症状):不卡在选将询问 pending ──
    const hasSelectPending = [...state2.pendingSlots.values()].some(
      (s) => (s.atom as { type?: string }).type === '选将询问',
    );
    expect(hasSelectPending).toBe(false);

    // ── 核心断言 4:重启后游戏已推进到出牌阶段(等待 fire-and-forget 开局 execute 完成) ──
    // restore 返回时开局 execute 仍在后台推进(洗牌/发牌/回合启动),需等待其完成。
    // 用 phase 判定完成:开局 execute 跑到"主公出牌阶段"才算恢复成功。
    for (
      let i = 0;
      i < 300 && (state2.phase !== '出牌' || state2.pendingSlots.size === 0);
      i++
    )
      await sleep(10);
    // 已进入出牌阶段 = 开局 execute 已完成;且 pending 是出牌窗口而非选将询问。
    expect(state2.phase).toBe('出牌');
    expect(state2.players.every((p) => p.hand.length > 0)).toBe(true);
    const onlyBlockingSlotTypes = [...state2.pendingSlots.values()].map((s) =>
      (s.atom as { type?: string }).type,
    );
    expect(onlyBlockingSlotTypes.every((t) => t !== '选将询问')).toBe(true);
  }, 30000);
});
