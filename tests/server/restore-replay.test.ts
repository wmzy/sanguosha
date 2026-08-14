// tests/server/restore-replay.test.ts
// 验证 engine.restore 能正确重放含交互式选将的 actionLog。
// 根因:restore 重放循环无等待,fire-and-forget 的开局 execute 还没创建选将 slot 时,
// 选将 respond 的 validate 因 pendingSlots 为空被拒 → 选将 slot 永久挂起 → 重启后回到选将。
// 修复:restore 重放加 settle 同步,等 execute 到达挂起点(slot 创建)再发下一条 action。
// 归并建议:未来持久化恢复测试统一后,可与 tests/server/persistence.test.ts 合并。
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import '../../src/engine/atoms';
import { bootstrap, create, dispatch, restore, fireTimeout, type GameConfig } from '../../src/engine/index';
import { createGameState } from '../../src/engine/types';
import { VirtualClock } from '../../src/engine/core/clock';
import type { ActionLogEntry, GameState } from '../../src/engine/types';
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
  // 模拟 create():startedAt 非零,使 actionLog timestamp 为相对时间(Date.now()-startedAt)。
  // 否则 restore 的 VirtualClock(从 0 起)会 advanceTo 绝对时间戳 → 立即超时所有 slot。
  state.startedAt = state.clock.now();
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
    config: { name: '测试', timeoutSec: 30, charPool: 'all', handSize: 4 },
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
    // restore 契约:bootstrap 前注入 VirtualClock,重放按 actionLog 时间戳确定性推导超时。
    state2.clock = new VirtualClock();
    state2.startedAt = state2.clock.now();
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
    // 界放权(主公界刘禅)在出牌阶段开始前触发询问:respond 不发动,推进到出牌窗口。
    const lordIdx = state1.players.findIndex((p) => p.identity === '主公');
    for (let i = 0; i < 300 && ![...state1.pendingSlots.values()].some((s) => (s.atom as { requestType?: string }).requestType === '界放权/trigger'); i++) await sleep(10);
    if ([...state1.pendingSlots.values()].some((s) => (s.atom as { requestType?: string }).requestType === '界放权/trigger')) {
      void dispatch(state1, { skillId: '界放权', actionType: 'respond', ownerId: lordIdx, params: { choice: false }, baseSeq: state1.seq });
    }
    // 等出牌窗口(界放权询问 respond 后,开局 execute resume 到出牌窗口)
    for (let i = 0; i < 300 && ![...state1.pendingSlots.values()].some((s) => (s.atom as { type?: string }).type === '出牌窗口'); i++) await sleep(10);
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
    // restore 契约:bootstrap 前注入 VirtualClock,重放按 actionLog 时间戳确定性推导超时。
    state2.clock = new VirtualClock();
    state2.startedAt = state2.clock.now();
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

// ── 缺陷①②回归:restore 重放保真度(2026-08 UDFJRA 卡死诊断发现) ──
// 缺陷①:dispatch 的 skip 分支不记 actionLog → 无懈广播被全员快速 skip 的事实丢失,
//         重放只能靠虚拟时钟超时兜底 → resolve 时序错位 → RNG 链发散。
// 缺陷②:「设置手牌顺序」splice 条目被 restore 当普通 action dispatch → 命中并
//         pause+resolve 该 owner 的无关 pending(选牌面板/广播) → respond 被拒 → 发散。
describe('restore 重放盲选 splice 与广播 skip', () => {
  /** 给指定玩家手牌注入一张顺手牵羊(cardMap + hand 追加)。
   *  必须在 开局 execute 重建 cardMap 之后(出牌窗口已现)注入,否则会被重建抹掉;
   *  live 与重放两侧在同点位注入 → 不消耗 RNG、手牌序一致,重放可忠实复现。 */
  function injectSnatchCard(state: GameState, attacker: number): void {
    state.cardMap['sq-restore'] = {
      id: 'sq-restore',
      name: '顺手牵羊',
      suit: '♦',
      color: '红',
      rank: '4',
      type: '锦囊牌',
    };
    state.players[attacker].hand.push('sq-restore');
  }

  /** 驱动一局:选将 → 出牌窗口 →(注入顺手牵羊)→ 使用 → 全员 skip 无懈 →
   *  (使用前先整理目标手牌,模拟 handleReorderHand 的未记日志 mutation)→ 盲选 handIndex。 */
  async function playSnatchBlindPick(state1: GameState, config: GameConfig) {
    await playThroughCharSelect(state1, config);
    // 界放权询问若出现则不发动(镜像上方用例),推进到出牌窗口
    const lordIdx = state1.players.findIndex((p) => p.identity === '主公');
    for (
      let i = 0;
      i < 300 &&
      ![...state1.pendingSlots.values()].some(
        (s) => (s.atom as { requestType?: string }).requestType === '界放权/trigger',
      );
      i++
    )
      await sleep(10);
    if (
      [...state1.pendingSlots.values()].some(
        (s) => (s.atom as { requestType?: string }).requestType === '界放权/trigger',
      )
    ) {
      void dispatch(state1, {
        skillId: '界放权',
        actionType: 'respond',
        ownerId: lordIdx,
        params: { choice: false },
        baseSeq: state1.seq,
      });
    }
    for (
      let i = 0;
      i < 300 &&
      ![...state1.pendingSlots.values()].some(
        (s) => (s.atom as { type?: string }).type === '出牌窗口',
      );
      i++
    )
      await sleep(10);
    const attacker = lordIdx;
    const victim = (attacker + 1) % 4;

    const origVictimHand = [...state1.players[victim].hand];
    expect(origVictimHand.length).toBe(4);
    // 使用前整理目标手牌(handleReorderHand 纯 mutate,不进 actionLog):轮转 →
    // 盲选 handIndex=3 命中 origVictimHand[1],与未整理时的 hand[3]/hand[0] 均不同
    const rotated = [origVictimHand[2], origVictimHand[0], origVictimHand[3], origVictimHand[1]];
    state1.players[victim].hand = [...rotated];
    // 注入顺手牵羊(此点位 cardMap 已重建完毕,注入存活)
    injectSnatchCard(state1, attacker);

    void dispatch(state1, {
      skillId: '顺手牵羊',
      actionType: 'use',
      ownerId: attacker,
      params: { cardId: 'sq-restore', targets: [victim] },
      baseSeq: state1.seq,
    });
    // 等无懈广播槽(target<0)
    for (
      let i = 0;
      i < 300 &&
      ![...state1.pendingSlots.values()].some(
        (s) =>
          typeof (s.atom as { target?: unknown }).target === 'number' &&
          (s.atom as { target: number }).target < 0,
      );
      i++
    )
      await sleep(10);
    // 全员快速 skip(真实玩家决策,缺陷①修复后应记入 actionLog)
    for (const p of state1.players.filter((p) => p.alive)) {
      const r = await dispatch(state1, {
        skillId: '__skip',
        actionType: 'skip',
        ownerId: p.index,
        params: {},
        baseSeq: state1.seq,
      });
      await r.settle;
    }
    // 等选牌面板(pickTargetCard,slot keyed attacker)
    for (
      let i = 0;
      i < 300 &&
      ![...state1.pendingSlots.values()].some(
        (s) => (s.atom as { prompt?: { type?: string } }).prompt?.type === 'pickTargetCard',
      );
      i++
    )
      await sleep(10);
    // 盲选 handIndex=3 → rotated[3] = origVictimHand[1]
    const r = await dispatch(state1, {
      skillId: '顺手牵羊',
      actionType: 'respond',
      ownerId: attacker,
      params: { zone: 'hand', handIndex: 3 },
      baseSeq: state1.seq,
    });
    await r.settle;
    // 等出牌窗口重建(结算完成)
    for (
      let i = 0;
      i < 300 &&
      ![...state1.pendingSlots.values()].some(
        (s) => (s.atom as { type?: string }).type === '出牌窗口',
      );
      i++
    )
      await sleep(10);
    return { attacker, victim, origVictimHand, rotated };
  }

  /** bootstrap(VirtualClock 契约)+ 分段重放:先重放到 use(注入卡)条目前,
   *  等出牌窗口(此点位 cardMap 已由开局 execute 重建完毕),与原局同点位注入
   *  顺手牵羊,再重放剩余条目。restore 契约 slice(1) 跳过首条 → 第二段以 use 的
   *  前一条占位。注入的卡不是真实牌堆牌,无法走发牌;两侧同点位对称注入不消耗 RNG,
   *  手牌序一致,重放仍忠实。 */
  async function restoreWithInjection(
    state: GameState,
    config: GameConfig,
    actionLog: ActionLogEntry[],
    inject: (st: GameState) => void,
  ): Promise<void> {
    state.clock = new VirtualClock();
    state.startedAt = state.clock.now();
    await bootstrap(state, config);
    const useIdx = actionLog.findIndex(
      (e) => e.message.actionType === 'use' && e.message.skillId === '顺手牵羊',
    );
    expect(useIdx).toBeGreaterThan(0);
    await restore(state, config, actionLog.slice(0, useIdx));
    expect(await waitForPlayWindow(state)).toBe(true);
    inject(state);
    await restore(state, config, [actionLog[useIdx - 1], ...actionLog.slice(useIdx)]);
  }

  async function waitForPlayWindow(state: GameState): Promise<boolean> {
    for (let i = 0; i < 300; i++) {
      if (
        [...state.pendingSlots.values()].some(
          (s) => (s.atom as { type?: string }).type === '出牌窗口',
        )
      )
        return true;
      await sleep(10);
    }
    return false;
  }

  it('顺手牵羊盲选+整理手牌:skip 记入日志,重放后偷到的牌与手牌序与原局一致(缺陷①②)', async () => {
    const config = makeConfig(4);
    const state1 = makeState(4);
    const { attacker, victim, origVictimHand, rotated } = await playSnatchBlindPick(state1, config);

    // ── 原局断言 ──
    // 偷到的是整理后 hand[3] = origVictimHand[1](非 default hand[0],非原序 hand[3])
    expect(state1.players[attacker].hand).toContain(origVictimHand[1]);
    expect(state1.players[victim].hand).toEqual([origVictimHand[2], origVictimHand[0], origVictimHand[3]]);
    // 缺陷①:skip 记入 actionLog(4 名存活玩家)
    const actionLog = state1.actionLog.map((e) => ({ ...e }));
    const skipEntries = actionLog.filter((e) => e.message.actionType === 'skip');
    expect(skipEntries.length).toBe(4);
    // splice 条目记录整理后的顺序
    const spliceEntry = actionLog.find((e) => e.message.actionType === '设置手牌顺序');
    expect(spliceEntry).toBeTruthy();
    expect(spliceEntry!.message.params.order).toEqual(rotated);
    const origSeq = state1.seq;
    const origHands = state1.players.map((p) => [...p.hand]);

    // ── 重放(新格式:含 skip 条目)──
    const state2 = makeState(4);
    await restoreWithInjection(state2, config, actionLog, (st) => injectSnatchCard(st, attacker));
    // 等开局 execute 异步 resume 完成(出牌窗口出现)
    expect(await waitForPlayWindow(state2)).toBe(true);

    // 缺陷②核心断言:盲选取 handIndex 指定张(而非被提前消费 pending 后的 default hand[0])
    expect(state2.players[attacker].hand).toContain(origVictimHand[1]);
    expect(state2.players.map((p) => [...p.hand])).toEqual(origHands);
    expect(state2.seq).toBe(origSeq);
    // 重放后的 actionLog 保留 splice 条目(二次重启不丢盲选顺序)
    expect(state2.actionLog.some((e) => e.message.actionType === '设置手牌顺序')).toBe(true);
  }, 30000);

  it('旧格式日志(剥离 skip 条目)靠广播滞留兜底重放,终态与新格式一致(向后兼容)', async () => {
    const config = makeConfig(4);
    const state1 = makeState(4);
    const { attacker, origVictimHand } = await playSnatchBlindPick(state1, config);
    const actionLog = state1.actionLog.map((e) => ({ ...e }));
    const origSeq = state1.seq;
    const origHands = state1.players.map((p) => [...p.hand]);

    // 模拟旧格式(缺陷①修复前的持久化日志):无 skip 条目
    const legacyLog = actionLog.filter((e) => e.message.actionType !== 'skip');
    expect(legacyLog.length).toBeLessThan(actionLog.length);

    const state3 = makeState(4);
    await restoreWithInjection(state3, config, legacyLog, (st) => injectSnatchCard(st, attacker));
    expect(await waitForPlayWindow(state3)).toBe(true);

    // 兜底(广播滞留自动补 skip)使旧日志重放仍忠实:终态与新格式一致
    expect(state3.players[attacker].hand).toContain(origVictimHand[1]);
    expect(state3.players.map((p) => [...p.hand])).toEqual(origHands);
    expect(state3.seq).toBe(origSeq);
    // 补发的 skip 记入重放后的 actionLog(旧格式自此转为新格式)
    expect(state3.actionLog.some((e) => e.message.actionType === 'skip')).toBe(true);
  }, 30000);
});

// ── UDFJRA 真实对局日志端到端(2026-08-14 卡死房间备份,旧格式)──
// 原局含:顺手牵羊盲选(splice 条目)、无懈广播全员快速 skip(未记录)、界将驰询问。
// 修复前:plain restore 因缺陷①②发散;修复后重放不发散不冻结(终态有出牌窗口)。
describe('restore 重放 UDFJRA 真实对局日志', () => {
  const UDFJRA_SEED = 1786705779013;
  function loadUdfjraLog(): ActionLogEntry[] {
    return JSON.parse(
      readFileSync(new URL('./fixtures/UDFJRA-actionLog.json', import.meta.url), 'utf8'),
    );
  }
  async function replayUdfjra(): Promise<{ state: GameState; errors: string[] }> {
    const config: GameConfig = {
      characters: CHARACTERS,
      playerCount: 2,
      seed: UDFJRA_SEED,
      gameId: 'UDFJRA-replay',
      timeoutSec: 30,
      mode: '身份局',
    };
    const state = create(config);
    state.clock = new VirtualClock();
    state.startedAt = state.clock.now();
    const errors: string[] = [];
    state.onError = (e) => errors.push(e.stack ?? String(e));
    await bootstrap(state, config);
    await restore(state, config, loadUdfjraLog());
    return { state, errors };
  }

  it('盲选 splice 直接重排、广播滞留补 skip,重放无错且终态非冻结(有出牌窗口)', async () => {
    const { state, errors } = await replayUdfjra();
    expect(errors).toEqual([]);
    // 非冻结:原冻结态 pendingSlots 为空;重放后游戏推进到出牌窗口。
    // restore 返回时父 execute 的 resume 链可能仍在飞行,轮询至窗口出现。
    let window: unknown;
    for (let i = 0; i < 300; i++) {
      window = [...state.pendingSlots.values()].find(
        (s) => (s.atom as { type?: string }).type === '出牌窗口',
      );
      if (window) break;
      await sleep(10);
    }
    expect(window).toBeTruthy();
    // 盲选链路忠实:P0 经 顺手牵羊 盲取 hand[1](order-8-1 下为八卦阵)并装备(entry 10)
    expect(Object.values(state.players[0].equipment)).toContain('八卦阵-♣2-84');
    // 重放后的 actionLog:保留 splice 条目 + 补记 skip(旧转新格式)
    expect(state.actionLog.some((e) => e.message.actionType === '设置手牌顺序')).toBe(true);
    expect(state.actionLog.some((e) => e.message.actionType === 'skip')).toBe(true);
  }, 30000);

  it('重放确定性:两次独立重放终态 seq 与手牌一致', async () => {
    const a = await replayUdfjra();
    const b = await replayUdfjra();
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    for (let i = 0; i < 300; i++) {
      const settled = (st: GameState) =>
        [...st.pendingSlots.values()].some((s) => (s.atom as { type?: string }).type === '出牌窗口');
      if (settled(a.state) && settled(b.state)) break;
      await sleep(10);
    }
    expect(b.state.seq).toBe(a.state.seq);
    expect(b.state.players.map((p) => [...p.hand])).toEqual(a.state.players.map((p) => [...p.hand]));
  }, 30000);
});
