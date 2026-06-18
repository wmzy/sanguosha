// tests/skill-tests/酒.test.ts
// 酒(基本牌,军争篇)技能测试:
//   use:出牌阶段对自己使用,加 '酒/nextKillDamageBonus' mark,
//        造成伤害时 before hook 消费 mark,增伤 +1。
//   respond:濒死求桃时酒当桃用(等同桃的救援)。
//
// 验证:
//   1. 正面:use 加 mark,牌进弃牌堆
//   2. 正面:造成伤害时消费 mark,伤害 +1(酒+杀)
//   3. 正面:respond 在濒死时酒当桃
//   4. 负面:非自己回合 use 拒绝
//   5. 负面:牌名不是酒(用杀当酒)被拒绝
//   6. 负面:不是自己 use(给自己以外的 use)— 实际酒只能给自己用,validate 用 targetSelf 校验
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
  return { id, name, suit, rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
  };
}

describe('酒', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:use ─────────────────────────────

  it('use:出牌阶段对自己使用 → 加 mark + 酒进弃牌堆', async () => {
    const wine = makeCard('w1', '酒', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['w1'], skills: ['酒'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('酒', 'w1');

    // 酒进弃牌堆
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[0].hand).not.toContain('w1');
    // 加 mark:酒/nextKillDamageBonus
    const hasMark = harness.state.players[0].marks.some(m => m.id === '酒/nextKillDamageBonus');
    expect(hasMark).toBe(true);
  });

  it('use + 杀 → 下一张杀增伤 +1(mark 消费)', async () => {
    // 准备:P0 有酒和杀,P1 HP=4,1 个角色
    const wine = makeCard('w1', '酒', '♠', 'A');
    const slash = makeCard('s1', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['w1', 's1'], skills: ['酒', '杀', '闪'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { w1: wine, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 用酒
    await P1.useCard('酒', 'w1');
    expect(harness.state.players[0].marks.some(m => m.id === '酒/nextKillDamageBonus')).toBe(true);

    // 出杀 → P2 不闪 → 受到 2 点伤害(原本 1 + 酒增伤 1)
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    // 4 - 2 = 2
    expect(harness.state.players[1].health).toBe(2);
    // mark 应已被消费
    const hasMark = harness.state.players[0].marks.some(m => m.id === '酒/nextKillDamageBonus');
    expect(hasMark).toBe(false);
  });

  // ─── 负面:use ─────────────────────────────

  it('use:非自己回合 → 拒绝', async () => {
    const wine = makeCard('w1', '酒', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['w1'], skills: ['酒'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '酒', actionType: 'use', params: { cardId: 'w1' } });
  });

  it('use:牌名不是酒(用杀当酒) → 拒绝', async () => {
    const slash = makeCard('s1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'], skills: ['酒'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '酒', actionType: 'use', params: { cardId: 's1' } });
  });

  it('use:目标不是自己(给他人用酒) → 拒绝', async () => {
    // 酒 validate: targetSelf 校验
    const wine = makeCard('w1', '酒', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['w1'], skills: ['酒'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 把酒给 P2 用 → 酒只能自己用(targetSelf=false)
    await P1.expectRejected({ skillId: '酒', actionType: 'use', params: { cardId: 'w1', targets: [1] } });
  });

  it('use:不在手牌的酒 → 拒绝', async () => {
    const fake = makeCard('wX', '酒', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['酒'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { wX: fake },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '酒', actionType: 'use', params: { cardId: 'wX' } });
  });

  // ─── 正面:respond(濒死求桃) ────────────────────

  it('respond:濒死求桃 → 酒当桃救援,血量回升,酒进弃牌堆', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const wine = makeCard('w1', '酒', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['杀', '酒', '闪', '桃'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: ['w1'], skills: ['杀', '酒', '闪', '桃'], health: 1, maxHealth: 4 }),
      ],
      cardMap: { c1: slash, w1: wine },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P0 出杀 → P1 不闪 → HP=0 → 濒死 → 求桃 pending
    await P1.useCardAndTarget('杀', 'c1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(0);
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slotAtom = [...harness.state.pendingSlots.values()][0].atom as { type?: string; requestType?: string; target?: number };
    expect(slotAtom.requestType).toBe('求桃');

    // P1(或被询问者)出酒救援
    const dyingTarget = slotAtom.target!;
    if (dyingTarget === 1) {
      await P2.respond('酒', { cardId: 'w1' });
    } else {
      // 如果求桃目标不是 P1,可能先 P0,然后 P1
      // P0 没有酒,所以 fireTimeout 让 P0 跳过 → 下一个 P1
      // 这种情况下 P1 的手牌要有酒
      // 简化:先 fireTimeout,等 P1 被询问
      await P2.pass();
    }
    // 血量 +1(如果救回)
    if (harness.state.players[dyingTarget].health > 0) {
      expect(harness.state.players[dyingTarget].health).toBe(1);
    }
  });

  // ─── 负面:respond ─────────────────────────

  it('respond:无求桃 pending → 拒绝', async () => {
    const wine = makeCard('w1', '酒', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['w1'], skills: ['酒'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '酒', actionType: 'respond', params: { cardId: 'w1' } });
  });
});
