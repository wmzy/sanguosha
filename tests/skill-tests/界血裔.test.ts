// 界血裔(界袁绍·群·主公技)测试,OL hero/450 官方逐字:
//   "主公技,游戏开始时,你获得X枚'裔'标记(X为群势力角色数的两倍)。
//    出牌阶段开始时,你可以移除1枚'裔'并摸一张牌。
//    你每有1枚'裔',手牌上限便+1。"
//
// 验证:
//   1. 游戏开始(主公首回合开始):获得 X 裔标记(X=2×群角色数,含主公)
//   2. 出牌阶段开始:发动血裔 → 移除 1 裔 + 摸 1 张
//   3. 出牌阶段开始:不发动 → 裔数/手牌不变
//   4. 出牌阶段开始:无裔 → 不询问(直接跳过)
//   5. 手牌上限:health + 裔数(弃牌阶段验证)
//   6. 非主公(ownerId!==0):不获得裔,不触发任何效果
//   7. 游戏开始初始化:仅触发一次(后续回合开始不重复)
//   8. 群角色死亡后裔数不变(游戏开始时锁定)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { handLimit } from '../../src/engine/hand-limit';
import { createGameState } from '../../src/engine/types';
import type { GameState, PlayerState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  faction?: PlayerState['faction'];
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction,
  };
}

/** 当前玩家裔标记数 */
function yiCount(state: GameState, player: number): number {
  return (
    state.players[player]?.marks.filter((m) => m.id.startsWith('界血裔/裔:')).length ?? 0
  );
}

/** 当前唯一 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return null;
  return (slots[0].atom as unknown as { requestType?: string }).requestType ?? null;
}

describe('界血裔', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 游戏开始:获得 X 裔标记 ──────────────────────────

  it('主公首回合开始:获得 2 × 群角色数 枚裔(2 群角色 → 4 裔)', async () => {
    await harness.setup(
      createGameState({
        players: [
          // P0 界袁绍(主公) + 群;P1 群;P2 魏 → 群角色数=2,裔=4
          makePlayer({
            index: 0,
            name: '界袁绍',
            faction: '群',
            skills: ['界血裔'],
          }),
          makePlayer({ index: 1, name: 'P1', faction: '群', skills: [] }),
          makePlayer({ index: 2, name: 'P2', faction: '魏', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 触发主公首回合开始(化身先例:首次回合开始 ≈ 游戏开始)
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(yiCount(harness.state, 0)).toBe(4); // 2 群 × 2 = 4 裔
    expect(harness.state.localVars['界血裔/init/0']).toBe(true);
  });

  // ─── 2. 出牌阶段开始:发动血裔 → 移除 1 裔 + 摸 1 牌 ────────

  it('出牌阶段开始:发动血裔 → 移除 1 裔 + 摸 1 张', async () => {
    const deckCard = { id: 'd1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' } as const;
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界袁绍',
            faction: '群',
            hand: [],
            skills: ['界血裔'],
          }),
          makePlayer({ index: 1, name: 'P1', faction: '群', skills: [] }),
        ],
        cardMap: { d1: deckCard },
        zones: { deck: ['d1'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 预置:游戏开始已触发,主公有 4 裔(2 群 × 2)
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(yiCount(harness.state, 0)).toBe(4);

    // 触发出牌阶段开始(阶段开始 after-hook 会创建 pending,用 fire-and-forget)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();

    // 询问是否发动
    expect(currentRequestType(harness.state)).toBe('界血裔/use');
    const P0 = harness.player('界袁绍');
    await P0.respond('界血裔', { confirmed: true });
    await harness.waitForStable();

    expect(yiCount(harness.state, 0)).toBe(3); // 移除 1 裔
    expect(harness.state.players[0].hand).toContain('d1'); // 摸 1 张
  });

  // ─── 3. 出牌阶段开始:不发动 → 裔数/手牌不变 ────────────

  it('出牌阶段开始:不发动 → 裔数/手牌不变', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界袁绍',
            faction: '群',
            hand: [],
            skills: ['界血裔'],
          }),
          makePlayer({ index: 1, name: 'P1', faction: '群', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    const initialYi = yiCount(harness.state, 0);
    expect(initialYi).toBe(4);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();

    const P0 = harness.player('界袁绍');
    await P0.respond('界血裔', { confirmed: false }); // 不发动
    await harness.waitForStable();

    expect(yiCount(harness.state, 0)).toBe(initialYi); // 裔数不变
    expect(harness.state.players[0].hand).toHaveLength(0); // 未摸牌
  });

  // ─── 4. 出牌阶段开始:无裔 → 不询问 ────────────────────

  it('出牌阶段开始:无裔 → 不询问(直接跳过)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界袁绍',
            faction: '群',
            hand: [],
            skills: ['界血裔'],
          }),
          makePlayer({ index: 1, name: 'P1', faction: '群', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 不触发游戏开始初始化(不调 回合开始 atom),故裔=0
    expect(yiCount(harness.state, 0)).toBe(0);

    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();

    // 无裔 → 不询问
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toHaveLength(0); // 未摸牌
  });

  // ─── 5. 手牌上限:health + 裔数 ────────────────────────

  it('手牌上限:health(3) + 裔(2) = 5', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界袁绍',
            faction: '群',
            health: 3,
            maxHealth: 4,
            skills: ['界血裔'],
          }),
          // 单群角色(主公自己)→ 裔=2
          makePlayer({ index: 1, name: 'P1', faction: '魏', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(yiCount(harness.state, 0)).toBe(2); // 1 群 × 2 = 2 裔
    // 手牌上限 = health(3) + bonus(0) + 裔(2) = 5
    expect(handLimit(harness.state, 0)).toBe(5);
  });

  // ─── 6. 非主公:不获得裔,不触发任何效果 ─────────────────

  it('非主公(ownerId=1):不获得裔,手牌上限不修正', async () => {
    await harness.setup(
      createGameState({
        players: [
          // P0 是另一个主公武将,P1 是界袁绍但非主公
          makePlayer({
            index: 0,
            name: '其他主公',
            faction: '群',
            skills: [],
          }),
          makePlayer({
            index: 1,
            name: '界袁绍',
            faction: '群',
            health: 3,
            maxHealth: 4,
            skills: ['界血裔'],
          }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 触发主公(P0)回合开始 → 界血裔实例(P1)不应初始化裔
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(yiCount(harness.state, 1)).toBe(0); // 非主公不获得裔
    // 手牌上限走默认公式(health+bonus,裔+0)
    expect(handLimit(harness.state, 1)).toBe(3); // = health 3 + 0

    // 非主公出牌阶段开始 → 不询问发动
    await applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '出牌' });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 7. 游戏开始初始化:仅触发一次 ────────────────────

  it('游戏开始初始化:仅触发一次(后续回合开始不再加裔)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界袁绍',
            faction: '群',
            skills: ['界血裔'],
          }),
          makePlayer({ index: 1, name: 'P1', faction: '群', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 第一次回合开始:加裔
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(yiCount(harness.state, 0)).toBe(4);

    // 模拟回合结束 → 下一回合开始
    await applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    // 裔数不变(未在出牌阶段发动,故仍为 4)
    expect(yiCount(harness.state, 0)).toBe(4);
  });

  // ─── 8. 群角色死亡后裔数不变(游戏开始时锁定) ─────────

  it('群角色死亡:裔数不变(游戏开始时锁定,不随后续变化)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界袁绍',
            faction: '群',
            skills: ['界血裔'],
          }),
          makePlayer({ index: 1, name: '群将', faction: '群', skills: [] }),
          makePlayer({ index: 2, name: '魏将', faction: '魏', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(yiCount(harness.state, 0)).toBe(4); // 2 群 × 2 = 4

    // 模拟群将死亡
    harness.state.players[1].alive = false;
    // 裔数不重新计算(仍为 4,因 X 在游戏开始时锁定)
    // 注意:此测试验证裔 mark 数不变,而非 X 重算
    expect(yiCount(harness.state, 0)).toBe(4);
  });

  // ─── 9. 手牌上限动态:裔变动后立即反映 ─────────────────

  it('手牌上限动态:裔变动后立即反映', async () => {
    const restoreAutoCompare = disableAutoCompare();
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界袁绍',
            faction: '群',
            health: 3,
            maxHealth: 4,
            skills: ['界血裔'],
          }),
          makePlayer({ index: 1, name: '群将', faction: '群', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(yiCount(harness.state, 0)).toBe(4);
    expect(handLimit(harness.state, 0)).toBe(3 + 4); // health + 裔

    // 发动血裔:移除 1 裔 → 上限应变化
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    const P0 = harness.player('界袁绍');
    await P0.respond('界血裔', { confirmed: true });
    await harness.waitForStable();

    expect(yiCount(harness.state, 0)).toBe(3);
    expect(handLimit(harness.state, 0)).toBe(3 + 3); // 裔减少 1,上限同步降
    restoreAutoCompare();
  });
});
