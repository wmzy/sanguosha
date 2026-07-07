// tests/skill-tests/红颜.test.ts
// 红颜(小乔·锁定技):你的黑桃牌均视为红桃牌。
//
// 验证:
//   1. 小乔判定时,牌堆顶黑桃 → 视为红桃(花色被转换)
//   2. 集成:小乔挂闪电,判定黑桃5(本应命中)→ 红颜转为红桃 → 不命中,不受伤
//   3. 红颜只影响小乔自己的判定:其他角色判定黑桃不受影响
//   4. 非黑桃判定牌不受影响
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, fireTimeoutAndWait, waitForStable } from '../engine-harness';
import { applyAtom, pushFrame, popFrame } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  pendingTricks?: Array<{ name: string; source: number; card: Card }>;
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    tags: [],
    judgeZone: [],
  };
}

describe('红颜', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 直接判定:黑桃 → 红桃 ───────────────────────
  it('小乔判定:牌堆顶黑桃 → 花色转为红桃', async () => {
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // 黑桃
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '小乔', skills: ['红颜'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    // 直接驱动判定 atom(在结算帧内)
    await pushFrame(harness.state, 'test', 0, {});
    await applyAtom(harness.state, { type: '判定', player: 0, judgeType: '红颜测试' });
    await popFrame(harness.state);
    await waitForStable(harness.state);
    harness.player('小乔').processEvents();

    // 红颜已将黑桃转为红桃
    expect(harness.state.cardMap['j1'].suit).toBe('♥');
    expect(harness.state.cardMap['j1'].color).toBe('红');
    // 判定牌已进弃牌堆
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 2. 集成:闪电判定黑桃5 → 红颜转红桃 → 不命中 ───────────────────────
  it('闪电判定黑桃5 → 红颜转为红桃 → 不受伤害,闪电传给下家', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠', 'A', '锦囊牌');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // 黑桃5(本应命中闪电)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '小乔',
          skills: ['红颜', '闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 0, card: lightningCard }],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪电', '回合管理'], health: 4 }),
      ],
      cardMap: { sd1: lightningCard, j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('小乔');

    // 触发判定阶段(闪电 before-hook on 阶段开始)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

    // 红颜把黑桃5转为红桃 → 闪电不命中 → 小乔不受伤
    expect(harness.state.players[0].health).toBe(3);
    // 闪电从 小乔 判定区移除
    expect(harness.state.players[0].pendingTricks.length).toBe(0);
    // 闪电传给下家 P2
    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('闪电');
    P1.processEvents();
    P1.expectView((v) => expect(v.players[0].health).toBe(3));
  });

  // ─── 3. 红颜只影响小乔自己的判定 ───────────────────────
  it('其他角色判定黑桃 → 红颜不生效,花色不变', async () => {
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '小乔', skills: ['红颜'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    // P2(非小乔)判定 → 红颜不应改花色
    await pushFrame(harness.state, 'test', 1, {});
    await applyAtom(harness.state, { type: '判定', player: 1, judgeType: '测试' });
    await popFrame(harness.state);
    await waitForStable(harness.state);
    harness.player('P2').processEvents();

    expect(harness.state.cardMap['j1'].suit).toBe('♠');
    expect(harness.state.cardMap['j1'].color).toBe('黑');
  });

  // ─── 4. 非黑桃判定牌不受影响 ───────────────────────
  it('红桃判定牌 → 红颜不改变(本就是红桃)', async () => {
    const judgeCard = makeCard('j1', '判定牌', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '小乔', skills: ['红颜'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    await pushFrame(harness.state, 'test', 0, {});
    await applyAtom(harness.state, { type: '判定', player: 0, judgeType: '测试' });
    await popFrame(harness.state);
    await waitForStable(harness.state);
    harness.player('小乔').processEvents();

    expect(harness.state.cardMap['j1'].suit).toBe('♥');
  });
});
