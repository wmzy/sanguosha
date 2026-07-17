// 不屈(周泰·锁定技)行为测试:
//   1. 濒死翻创牌(点数全新)→ 以0体力存活,创牌1张
//   2. 已有创牌时再濒死,新创牌点数不同 → 存活,创牌累积至2张
//   3. 新创牌点数与已有创牌重复 → 不屈失败,求桃无人救 → 死亡
//   4. 不屈状态下再次受伤 → 再次触发不屈(不屈状态循环)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  return { id, name, suit, color, rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  vars?: Record<string, unknown>;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: (opts.vars ?? {}) as GameState['players'][number]['vars'],
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('不屈', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('濒死翻创牌(点数全新)→ 以0体力存活,创牌1张', async () => {
    const slash = mkCard('s1', '杀', '♠', '7');
    const deck1 = mkCard('d1', '闪', '♥', '7'); // 牌堆顶,将作为创牌(点数7)

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '周泰',
            character: '周泰',
            skills: ['不屈'],
            health: 1, // 一击即濒死
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            hand: [slash.id],
            skills: ['杀'],
          }),
        ],
        cardMap: { s1: slash, d1: deck1 },
        zones: { deck: ['d1'], discardPile: [], processing: [] },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P2 = harness.player('P2');
    const ZT = harness.player('周泰');

    await P2.useCardAndTarget('杀', 's1', [0]);
    await ZT.pass(); // 不出闪 → 受伤濒死
    await harness.waitForStable();

    // 不屈自动触发(锁定技):翻创牌,点数全新 → 以0体力存活
    expect(harness.state.players[0].alive).toBe(true);
    expect(harness.state.players[0].health).toBe(0);
    // 创牌列表 = [d1]
    expect(harness.state.players[0].vars['不屈/创牌']).toEqual(['d1']);
    void ZT;
  });

  it('已有创牌时再濒死,新创牌点数不同 → 存活,创牌累积至2张', async () => {
    const slash = mkCard('s2', '杀', '♠', '5');
    const exist = mkCard('cA', '杀', '♠', '7'); // 已有创牌(点数7)
    const deck1 = mkCard('d2', '闪', '♥', '8'); // 牌堆顶新创牌(点数8,不同于7)

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '周泰',
            character: '周泰',
            skills: ['不屈'],
            health: 1,
            maxHealth: 4,
            vars: { '不屈/创牌': ['cA'] }, // 已有1张创牌(点数7)
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            hand: [slash.id],
            skills: ['杀'],
          }),
        ],
        cardMap: { s2: slash, cA: exist, d2: deck1 },
        zones: { deck: ['d2'], discardPile: [], processing: [] },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P2 = harness.player('P2');
    const ZT = harness.player('周泰');

    await P2.useCardAndTarget('杀', 's2', [0]);
    await ZT.pass();
    await harness.waitForStable();

    // 新创牌点数8 ≠ 已有7 → 存活,创牌累积
    expect(harness.state.players[0].alive).toBe(true);
    expect(harness.state.players[0].health).toBe(0);
    expect(harness.state.players[0].vars['不屈/创牌']).toEqual(['cA', 'd2']);
    void ZT;
  });

  it('新创牌点数与已有创牌重复 → 不屈失败,求桃无人救 → 死亡', async () => {
    const slash = mkCard('s3', '杀', '♠', '5');
    const exist = mkCard('cB', '杀', '♠', '7'); // 已有创牌(点数7)
    const deck1 = mkCard('d3', '闪', '♥', '7'); // 牌堆顶新创牌(点数7,重复!)

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '周泰',
            character: '周泰',
            skills: ['不屈'],
            health: 1,
            maxHealth: 4,
            vars: { '不屈/创牌': ['cB'] }, // 已有1张创牌(点数7)
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            hand: [slash.id],
            skills: ['杀'],
          }),
        ],
        cardMap: { s3: slash, cB: exist, d3: deck1 },
        zones: { deck: ['d3'], discardPile: [], processing: [] },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P2 = harness.player('P2');
    const ZT = harness.player('周泰');

    await P2.useCardAndTarget('杀', 's3', [0]);
    await ZT.pass(); // 不出闪 → 受伤濒死 → 不屈翻出点数7(重复)→ 失败
    await harness.waitForStable();

    // 不屈失败 → 进入求桃流程;两人都无桃 → pass 掉所有求桃 pending
    while (harness.state.pendingSlots.size > 0) {
      const slot = [...harness.state.pendingSlots.values()][0];
      const target = (slot.atom as { target?: number }).target ?? 0;
      await harness.player(target).pass();
      await harness.waitForStable();
    }

    // 周泰死亡
    expect(harness.state.players[0].alive).toBe(false);
    // 失败的创牌被移去(进弃牌堆,不入武将牌)——官方"否则移去此牌"
    // (标版语义上"重复即死亡",武将牌上的创牌在死亡后无意义;atom 统一处理为移去)
    expect(harness.state.players[0].vars['不屈/创牌']).toEqual(['cB']); // 仍只有原 cB
    expect(harness.state.zones.discardPile).toContain('d3'); // d3 进弃牌堆
    void P2;
    void ZT;
  });

  it('不屈状态下再次受伤 → 再次触发不屈(不屈状态循环)', async () => {
    const slash1 = mkCard('s4', '杀', '♠', '4');
    const slash2 = mkCard('s5', '杀', '♠', '6');
    const deck1 = mkCard('d4', '闪', '♥', '7'); // 第一次不屈创牌(点数7)
    const deck2 = mkCard('d5', '桃', '♦', '8'); // 第二次不屈创牌(点数8,不同于7)

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '周泰',
            character: '周泰',
            skills: ['不屈'],
            health: 1,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            hand: [slash1.id, slash2.id],
            skills: ['杀', '诸葛连弩'], // 连弩:无限出杀
          }),
        ],
        cardMap: { s4: slash1, s5: slash2, d4: deck1, d5: deck2 },
        // 牌堆:底→顶 = [d5(8), d4(7)],顶部 d4 先翻
        zones: { deck: ['d5', 'd4'], discardPile: [], processing: [] },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P2 = harness.player('P2');
    const ZT = harness.player('周泰');

    // 第一次杀 → 濒死 → 不屈#1(点数7,全新)→ 存活
    await P2.useCardAndTarget('杀', 's4', [0]);
    await ZT.pass();
    await harness.waitForStable();
    expect(harness.state.players[0].alive).toBe(true);
    expect(harness.state.players[0].health).toBe(0);
    expect(harness.state.players[0].vars['不屈/创牌']).toEqual(['d4']);

    // 第二次杀(不屈状态下体力仍0,受伤不降)→ 再次濒死 → 不屈#2(点数8≠7)→ 存活
    await P2.useCardAndTarget('杀', 's5', [0]);
    await ZT.pass();
    await harness.waitForStable();
    expect(harness.state.players[0].alive).toBe(true);
    expect(harness.state.players[0].health).toBe(0);
    expect(harness.state.players[0].vars['不屈/创牌']).toEqual(['d4', 'd5']);
    void ZT;
  });
});
