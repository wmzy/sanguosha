// 界不屈(界周泰·锁定技)行为测试(OL hero/210 官方逐字):
//   "当你处于濒死状态时,你将牌堆顶的一张牌置于你的武将牌上,称为'创',
//    若此牌点数与其他'创'均不同,你回复至1点体力,否则移去此牌。
//    若你的武将牌上有'创',你的手牌上限为'创'的数量。"
//
// 测试场景:
//   1. 濒死翻创牌(点数全新)→ 回复至1体力(界版差异),创牌1张
//   2. 已有创牌时再濒死,新创牌点数不同 → 存活,创牌累积至2张,回复至1体力
//   3. 新创牌点数与已有创牌重复 → 此牌移去(进弃牌堆,不入武将牌),求桃无人救 → 死亡
//   4. 有"创"时手牌上限=创牌数量(hand-limit provider 覆盖默认公式)
//
// 旧实现的"回合结束弃创(流程②)"是凭空捏造,已删除——本测试不再覆盖该场景。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { handLimit } from '../../src/engine/hand-limit';
import type { Card, GameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
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

describe('界不屈', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('濒死翻创牌(点数全新)→ 回复至1体力(界版差异),创牌1张', async () => {
    const slash = mkCard('s1', '杀', '♠', '7');
    const deck1 = mkCard('d1', '闪', '♥', '7'); // 牌堆顶,将作为创牌(点数7)

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界周泰',
            character: '界周泰',
            skills: ['界不屈'],
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
    const ZT = harness.player('界周泰');

    await P2.useCardAndTarget('杀', 's1', [0]);
    await ZT.pass(); // 不出闪 → 受伤濒死
    await harness.waitForStable();

    // 界不屈自动触发:翻创牌(点数全新)→ 回复至1体力(标版是0体力,界版差异点)
    expect(harness.state.players[0].alive).toBe(true);
    expect(harness.state.players[0].health).toBe(1);
    expect(harness.state.players[0].vars['不屈/创牌']).toEqual(['d1']);
    void ZT;
  });

  it('已有创牌时再濒死,新创牌点数不同 → 存活,创牌累积至2张,回复至1体力', async () => {
    const slash = mkCard('s2', '杀', '♠', '5');
    const exist = mkCard('cA', '杀', '♠', '7'); // 已有创牌(点数7)
    const deck1 = mkCard('d2', '闪', '♥', '8'); // 牌堆顶新创牌(点数8,不同于7)

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界周泰',
            character: '界周泰',
            skills: ['界不屈'],
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
    const ZT = harness.player('界周泰');

    await P2.useCardAndTarget('杀', 's2', [0]);
    await ZT.pass();
    await harness.waitForStable();

    // 新创牌点数8 ≠ 已有7 → 存活,创牌累积;回复至1体力
    expect(harness.state.players[0].alive).toBe(true);
    expect(harness.state.players[0].health).toBe(1);
    expect(harness.state.players[0].vars['不屈/创牌']).toEqual(['cA', 'd2']);
    void ZT;
  });

  it('新创牌点数与已有创牌重复 → 此牌移去(进弃牌堆,不入武将牌),求桃无人救 → 死亡', async () => {
    const slash = mkCard('s3', '杀', '♠', '5');
    const exist = mkCard('cB', '杀', '♠', '7'); // 已有创牌(点数7)
    const deck1 = mkCard('d3', '闪', '♥', '7'); // 牌堆顶新创牌(点数7,重复!)

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界周泰',
            character: '界周泰',
            skills: ['界不屈'],
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
    const ZT = harness.player('界周泰');

    await P2.useCardAndTarget('杀', 's3', [0]);
    await ZT.pass(); // 不出闪 → 受伤濒死 → 界不屈翻出点数7(重复)→ 移去此牌
    await harness.waitForStable();

    // 界不屈失败 → 进入求桃流程;两人都无桃 → pass 掉所有求桃 pending
    while (harness.state.pendingSlots.size > 0) {
      const slot = [...harness.state.pendingSlots.values()][0];
      const target = (slot.atom as { target?: number }).target ?? 0;
      await harness.player(target).pass();
      await harness.waitForStable();
    }

    // 界周泰死亡
    expect(harness.state.players[0].alive).toBe(false);
    // 失败的创牌被移去:不入武将牌,而是进弃牌堆(置创牌 atom 修正后行为)
    expect(harness.state.players[0].vars['不屈/创牌']).toEqual(['cB']); // 仍只有原 cB
    expect(harness.state.zones.discardPile).toContain('d3'); // d3 进弃牌堆
    void P2;
    void ZT;
  });

  it('有"创"时手牌上限=创牌数量(覆盖默认公式)', async () => {
    // 界周泰已有 3 张创牌,体力1。默认手牌上限=体力=1,但创牌数量=3 应覆盖为 3。
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界周泰',
            character: '界周泰',
            skills: ['界不屈'],
            health: 1,
            maxHealth: 4,
            hand: [], // 无手牌
            vars: { '不屈/创牌': ['w1', 'w2', 'w3'] }, // 3 张创牌
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            skills: [],
          }),
        ],
        cardMap: {},
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // handLimit 应返回创牌数量=3(而非体力=1)
    expect(handLimit(harness.state, 0)).toBe(3);
  });

  it('无"创"时不覆盖手牌上限(走默认公式)', async () => {
    // 界周泰体力2,无创牌 → 走默认公式 health+bonus = 2
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界周泰',
            character: '界周泰',
            skills: ['界不屈'],
            health: 2,
            maxHealth: 4,
            vars: {}, // 无创牌
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            character: '反',
            skills: [],
          }),
        ],
        cardMap: {},
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 无创牌:不覆盖,走默认 health=2
    expect(handLimit(harness.state, 0)).toBe(2);
  });
});
