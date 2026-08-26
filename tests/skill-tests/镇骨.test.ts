// 镇骨(郝昭·魏·被动技)行为测试,风林火山 hero/408:
//   "结束阶段,你可以选择一名其他角色,本回合结束时和其下回合结束时,
//    其将手牌调整至与你手牌数相同(至多摸至五张)。"
//
// 触发方式:applyAtom(阶段开始·phase='回合结束') → 询问选目标 → applyAtom(回合结束) 两段调整。
//
// 覆盖:
//   1. 选目标 → 本回合结束:少→摸牌(差额,不超过5)
//   2. 摸牌上限:差额>5 时只摸5张
//   3. 目标下回合结束:再次调整(多→弃牌)
//   4. 不发动(pass 选目标)→ 无效果
//   5. 相等→无变化
//   6. 两段全流程 + 状态清除
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import { applyAtom } from '../../src/engine/core/apply';

// 注册镇骨技能模块(主 agent 统一注册 index.ts,此处测试内直接挂载)
setSkillModuleOverride('镇骨', () => import('../../src/engine/skills/镇骨'));
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function mkCard(id: string, name: string): Card {
  return { id, name, suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
}

function mkPlayer(opts: {
  index: number;
  name: string;
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
  };
}

function cardMapFor(ids: string[]): Record<string, Card> {
  const m: Record<string, Card> = {};
  for (const id of ids) m[id] = mkCard(id, '杀');
  return m;
}

/** 是否存在 requestType 为 rt 的 pending */
function hasPending(state: GameState, rt: string): boolean {
  for (const slot of state.pendingSlots.values()) {
    if ((slot.atom as { requestType?: string }).requestType === rt) return true;
  }
  return false;
}

describe('镇骨', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 本回合结束:目标少→摸牌 ─────────────────────────
  it('结束阶段选目标 → 本回合结束:目标手牌少则摸至与郝昭相同', async () => {
    // 郝昭(P0)4 张,P1 1 张。差额3,摸3。
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '郝昭', hand: ['h1', 'h2', 'h3', 'h4'], skills: ['镇骨', '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', hand: ['p1'], skills: ['回合管理'] }),
        ],
        cardMap: cardMapFor(['h1', 'h2', 'h3', 'h4', 'p1', '__test_deck_0', '__test_deck_1', '__test_deck_2']),
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const Hao = harness.player('郝昭');

    // 结束阶段:触发选目标询问
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    expect(hasPending(harness.state, '镇骨/选目标')).toBe(true);

    // 郝昭选 P1
    await Hao.respond('镇骨', { targets: [1] });
    await harness.waitForStable();
    // 状态已记录
    expect(harness.state.players[0].vars['镇骨/目标']).toBe(1);
    expect(harness.state.players[0].vars['镇骨/阶段']).toBe('本回合');

    // 本回合结束 → 第一段调整:P1 摸 min(4-1,5)=3 张 → 4 张
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();

    expect(harness.state.players[1].hand.length).toBe(4);
    expect(harness.state.players[0].hand.length).toBe(4); // 郝昭不变
    // 阶段推进到 目标下回合
    expect(harness.state.players[0].vars['镇骨/阶段']).toBe('目标下回合');
  });

  // ─── 2. 摸牌上限:差额>5 只摸5 ───────────────────────────
  it('至多摸至五张:差额超过5时只摸5张', async () => {
    // 郝昭(P0)10 张,P1 0 张。差额10,但只摸5。
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '郝昭',
            hand: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10'],
            skills: ['镇骨', '回合管理'],
          }),
          mkPlayer({ index: 1, name: 'P1', hand: [], skills: ['回合管理'] }),
        ],
        cardMap: cardMapFor([
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10',
          '__test_deck_0', '__test_deck_1', '__test_deck_2', '__test_deck_3', '__test_deck_4',
        ]),
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const Hao = harness.player('郝昭');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    await Hao.respond('镇骨', { targets: [1] });
    await harness.waitForStable();

    // 本回合结束 → P1 摸 5(封顶)
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();

    expect(harness.state.players[1].hand.length).toBe(5);
  });

  // ─── 3. 目标下回合结束:多→弃牌 ──────────────────────────
  it('目标下回合结束:目标手牌多则弃至与郝昭相同', async () => {
    // 郝昭(P0)2 张,P1 5 张。第二段:P1 弃 3 → 2 张。
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '郝昭', hand: ['h1', 'h2'], skills: ['镇骨', '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', hand: ['p1', 'p2', 'p3', 'p4', 'p5'], skills: ['回合管理'] }),
        ],
        cardMap: cardMapFor(['h1', 'h2', 'p1', 'p2', 'p3', 'p4', 'p5']),
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const Hao = harness.player('郝昭');
    const P1 = harness.player('P1');

    // 结束阶段选 P1
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    await Hao.respond('镇骨', { targets: [1] });
    await harness.waitForStable();

    // 第一段(本回合结束):P1 5 > 郝昭 2 → P1 弃 3
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    // 弃牌询问出现
    expect(hasPending(harness.state, '镇骨/弃牌')).toBe(true);
    // P1 选弃 p1,p2,p3
    await P1.respond('镇骨', { cardIds: ['p1', 'p2', 'p3'] });
    await harness.waitForStable();
    expect(harness.state.players[1].hand.length).toBe(2);
    expect(harness.state.players[0].vars['镇骨/阶段']).toBe('目标下回合');

    // 模拟 P1 经过一回合后手牌变化(摸牌补足以便第二段再次触发弃牌)
    await applyAtom(harness.state, { type: '摸牌', player: 1, count: 3 });
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.players[1].hand.length).toBe(5);

    // 第二段(P1 下回合结束):P1 5 > 郝昭 2 → P1 弃 3
    void applyAtom(harness.state, { type: '回合结束', player: 1 });
    await harness.waitForStable();
    expect(hasPending(harness.state, '镇骨/弃牌')).toBe(true);
    const p1hand = [...harness.state.players[1].hand];
    await P1.respond('镇骨', { cardIds: p1hand.slice(0, 3) });
    await harness.waitForStable();
    expect(harness.state.players[1].hand.length).toBe(2);

    // 状态清除
    expect(harness.state.players[0].vars['镇骨/阶段']).toBeUndefined();
    expect(harness.state.players[0].vars['镇骨/目标']).toBeUndefined();
  });

  it('校验:弃牌回应 cardIds 含重复 id → 拒绝(不卡死)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '郝昭', hand: ['h1', 'h2'], skills: ['镇骨', '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', hand: ['p1', 'p2', 'p3', 'p4', 'p5'], skills: ['回合管理'] }),
        ],
        cardMap: cardMapFor(['h1', 'h2', 'p1', 'p2', 'p3', 'p4', 'p5']),
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const Hao = harness.player('郝昭');
    const P1 = harness.player('P1');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    await Hao.respond('镇骨', { targets: [1] });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    expect(hasPending(harness.state, '镇骨/弃牌')).toBe(true);

    // ['p1','p1','p2'] 数量=3 但含重复 → 去重校验拒绝
    await P1.expectRejected({
      skillId: '镇骨',
      actionType: 'respond',
      params: { cardIds: ['p1', 'p1', 'p2'] },
    });
    // 手牌未动
    expect(harness.state.players[1].hand.length).toBe(5);
    // 合法选择放行
    await P1.respond('镇骨', { cardIds: ['p1', 'p2', 'p3'] });
    await harness.waitForStable();
    expect(harness.state.players[1].hand.length).toBe(2);
  });

  // ─── 4. 不发动(pass 选目标)→ 无效果 ─────────────────────
  it('结束阶段 pass(不选目标)→ 镇骨不发动,无状态记录', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '郝昭', hand: ['h1', 'h2'], skills: ['镇骨', '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', hand: ['p1'], skills: ['回合管理'] }),
        ],
        cardMap: cardMapFor(['h1', 'h2', 'p1']),
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 结束阶段:出现选目标询问
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    expect(hasPending(harness.state, '镇骨/选目标')).toBe(true);

    // 超时(不选)= 不发动
    await harness.player('郝昭').pass();
    await harness.waitForStable();

    // 无状态记录
    expect(harness.state.players[0].vars['镇骨/目标']).toBeUndefined();
    expect(harness.state.players[0].vars['镇骨/阶段']).toBeUndefined();

    // 本回合结束 → 无任何调整
    const p1Before = harness.state.players[1].hand.length;
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    expect(harness.state.players[1].hand.length).toBe(p1Before);
  });

  // ─── 5. 相等 → 无变化 ───────────────────────────────────
  it('目标手牌与郝昭相等 → 本回合结束无变化', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '郝昭', hand: ['h1', 'h2', 'h3'], skills: ['镇骨', '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', hand: ['p1', 'p2', 'p3'], skills: ['回合管理'] }),
        ],
        cardMap: cardMapFor(['h1', 'h2', 'h3', 'p1', 'p2', 'p3']),
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const Hao = harness.player('郝昭');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    await Hao.respond('镇骨', { targets: [1] });
    await harness.waitForStable();

    // 本回合结束 → 相等,无变化(无弃牌询问)
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    expect(hasPending(harness.state, '镇骨/弃牌')).toBe(false);
    expect(harness.state.players[1].hand.length).toBe(3);
  });

  // ─── 6. 两段全流程(摸→摸) + 状态清除 ─────────────────────
  it('两段全流程:第一段摸牌,第二段也摸牌,结束后状态清除', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '郝昭', hand: ['h1', 'h2', 'h3'], skills: ['镇骨', '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', hand: ['p1'], skills: ['回合管理'] }),
          mkPlayer({ index: 2, name: 'P2', hand: [], skills: ['回合管理'] }),
        ],
        cardMap: cardMapFor([
          'h1', 'h2', 'h3', 'p1',
          '__test_deck_0', '__test_deck_1', '__test_deck_2',
          '__test_deck_3', '__test_deck_4',
        ]),
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const Hao = harness.player('郝昭');

    // 结束阶段选 P1
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    await Hao.respond('镇骨', { targets: [1] });
    await harness.waitForStable();

    // 第一段(本回合结束):P1 1 < 郝昭 3 → 摸 2 → 3 张
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    expect(harness.state.players[1].hand.length).toBe(3);

    // 中间玩家 P2 的回合结束:不应触发第二段(target=P1≠P2)
    void applyAtom(harness.state, { type: '回合结束', player: 2 });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['镇骨/阶段']).toBe('目标下回合'); // 仍待结算

    // P1 下回合结束 → 第二段:P1 3 = 郝昭 3 → 无变化,但状态清除
    void applyAtom(harness.state, { type: '回合结束', player: 1 });
    await harness.waitForStable();
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.players[0].vars['镇骨/阶段']).toBeUndefined();
    expect(harness.state.players[0].vars['镇骨/目标']).toBeUndefined();
  });
});
