// 掣政(孙亮·锁定技)测试 —— 来源:2026-08-25 bug 审查修复回归;此前无任何测试文件,
// 归并建议:如后续按武将合并测试文件,可与 立军/朱据 等孙亮技能并入同一文件。
//
//   官方逐字:「你防止于你的出牌阶段对攻击范围内不包含你的角色造成的伤害。
//   出牌阶段结束时,若你本阶段使用的牌数小于这些角色数,你弃置其中一名角色一张牌。」
//
//   修复点:「这些角色数」曾被错误过滤为「有牌可弃的角色数」——基数应按全部
//   攻击范围外角色计,可弃置目标才按有无牌过滤。
//
// 距离布局(5 人环形座次,默认攻击范围 1):
//   P0-P1 距离 1(范围内)、P0-P2 距离 2(范围外)、P0-P3 距离 2(范围外)、P0-P4 距离 1(范围内)
//   → 范围外角色 = {P2, P3},基数 = 2。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import { applyAtom } from '../../src/engine/core/apply';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suit === '♠' || suit === '♣' ? '黑' : '红', rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '吴将',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 5 人局:P0=孙亮(掣政);范围外={P2,P3};cards 指定各玩家手牌 */
function buildState(hands: Record<number, string[]>, rngSeed = 0): GameState {
  const cardMap: Record<string, Card> = {};
  for (const ids of Object.values(hands)) {
    for (const id of ids) cardMap[id] = makeCard(id, '杀', '♠', '7');
  }
  const state = createGameState({
    players: [
      makePlayer({ index: 0, name: '孙亮', character: '孙亮', hand: hands[0] }),
      makePlayer({ index: 1, name: 'P1', hand: hands[1] }),
      makePlayer({ index: 2, name: 'P2', hand: hands[2] }),
      makePlayer({ index: 3, name: 'P3', hand: hands[3] }),
      makePlayer({ index: 4, name: 'P4', hand: hands[4] }),
    ],
    cardMap,
    zones: { deck: [], discardPile: [], processing: [] },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    rngSeed,
  });
  // 孙亮挂掣政(setup 前注入 skills 数组即可,harness.setup 会加载实例)
  state.players[0].skills = ['掣政'];
  return state;
}

describe('掣政', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 修复点回归:基数按全部范围外角色计 ────────────────────
  it('范围外角色中有无牌者时仍触发:基数=2,used=1<2 → 自动弃有牌者(P3)一张', async () => {
    // P2 无牌(旧实现会把基数缩成 1 导致不触发),P3 一张手牌(弃哪张确定)
    await harness.setup(buildState({ 2: [], 3: ['p3a'] }));
    harness.state.turn.vars['掣政/出牌数'] = 1;

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await waitForStable(harness.state);

    // 仅 P3 一个有牌目标 → 自动选定并弃其唯一手牌
    expect(harness.state.zones.discardPile).toContain('p3a');
    expect(harness.state.players[3].hand).toEqual([]);
  });

  it('目标多张手牌时盲取随机弃一张(seed 变化结果可不同,不固定首张)', async () => {
    // 回归背景:曾固定取 hand[0],对手可按手牌排列利用;现按 seed RNG 盲取。
    const discarded = new Set<string>();
    for (let seed = 1; seed <= 24 && discarded.size < 2; seed++) {
      const h = new SkillTestHarness();
      await h.setup(buildState({ 2: [], 3: ['p3a', 'p3b'] }, seed));
      h.state.turn.vars['掣政/出牌数'] = 1;
      void applyAtom(h.state, { type: '阶段结束', player: 0, phase: '出牌' });
      await waitForStable(h.state);
      const pile = h.state.zones.discardPile;
      if (pile.includes('p3a')) discarded.add('p3a');
      if (pile.includes('p3b')) discarded.add('p3b');
    }
    // 24 个 seed 下两种结果全不出现的概率 ≈ 2^-23,视为不可能
    expect(discarded.size).toBe(2);
  });

  it('用牌数达到全部范围外角色数则不惩罚', async () => {
    await harness.setup(buildState({ 2: ['p2a'], 3: ['p3a'] }));
    harness.state.turn.vars['掣政/出牌数'] = 2;

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await waitForStable(harness.state);

    expect(harness.state.players[2].hand).toEqual(['p2a']);
    expect(harness.state.players[3].hand).toEqual(['p3a']);
    expect(harness.state.pendingSlots.get(0)).toBeUndefined();
  });

  // ─── 多名有牌目标:询问选择 ────────────────────
  it('多名候选时发掣政/选目标询问,选中者被弃一张', async () => {
    await harness.setup(buildState({ 2: ['p2a'], 3: ['p3a'] }));
    harness.state.turn.vars['掣政/出牌数'] = 1;

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await waitForStable(harness.state);

    const slot = harness.state.pendingSlots.get(0);
    expect(slot).toBeDefined();
    const atom = slot!.atom as { requestType?: string };
    expect(atom.requestType).toBe('掣政/选目标');

    const P0 = harness.player('孙亮');
    await P0.respond('掣政', { target: 3 });
    await waitForStable(harness.state);

    expect(harness.state.zones.discardPile).toContain('p3a');
    expect(harness.state.players[2].hand).toEqual(['p2a']);
  });
});
