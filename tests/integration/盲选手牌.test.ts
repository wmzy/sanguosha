// tests/integration/盲选手牌.test.ts
// 集成测试:过河拆桥/顺手牵羊的选牌面板(pickTargetCard) + 设置手牌顺序 splice 确定性。
//
// 覆盖:
//   1. 盲选第 N 张 → 正确取 hand[N]
//   2. actionLog 在 use 条目前 splice 了"设置手牌顺序"条目
//   3. 盲选超时 → defaultChoice 兜底
//   4. 选装备区明牌(zone=equipment)
//   5. 选判定区明牌(zone=judge)
//   6. 顺手牵羊盲选 → 获得指定手牌
//   7. 顺手牵羊选判定区 → 获得延时锦囊
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌'): Card {
  return { id, name, suit, rank, type };
}

function buildState(opts?: { p2Hand?: string[]; p2Equip?: Record<string, string>; p2Tricks?: Array<{ name: string; card: Card }>; extraCards?: Record<string, Card> }): GameState {
  const gq = makeCard('gq1', '过河拆桥', '♠', '3');
  const sq = makeCard('sq1', '顺手牵羊', '♠', '3');
  const cards: Record<string, Card> = {
    gq1: gq, sq1: sq,
    v1: makeCard('v1', '杀', '♥', '5', '基本牌'),
    v2: makeCard('v2', '闪', '♦', '6', '基本牌'),
    v3: makeCard('v3', '桃', '♣', '2', '基本牌'),
    ...(opts?.extraCards ?? {}),
  };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: 'X', health: 4, maxHealth: 4, alive: true, hand: ['gq1'], equipment: {}, skills: ['过河拆桥', '顺手牵羊', '杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: 'Y', health: 4, maxHealth: 4, alive: true, hand: opts?.p2Hand ?? ['v1', 'v2', 'v3'], equipment: opts?.p2Equip ?? {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('选牌面板(pickTargetCard)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  // ─────────────────────────────────────────────────────────────
  // 1. 盲选第 2 张 → 取 hand[1]=v2
  // ─────────────────────────────────────────────────────────────
  it('过河拆桥:盲选 handIndex=1 → 弃掉 v2(hand[1]),保留 v1', async () => {
    await harness.setup(buildState({ p2Hand: ['v1', 'v2', 'v3'] }));
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass(); // 无懈
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 1 });

    expect(harness.state.players[1].hand).toEqual(['v1', 'v3']);
    expect(harness.state.zones.discardPile).toContain('v2');
    expect(harness.state.zones.discardPile).toContain('gq1');
  });

  // ─────────────────────────────────────────────────────────────
  // 2. actionLog splice 了"设置手牌顺序",排在 use 之前
  // ─────────────────────────────────────────────────────────────
  it('盲选后 actionLog 含设置手牌顺序条目,且排在 use 之前', async () => {
    await harness.setup(buildState({ p2Hand: ['v1', 'v2', 'v3'] }));
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 2 });

    const log = harness.state.actionLog;
    const useIdx = log.findIndex(e => e.message.skillId === '过河拆桥' && e.message.actionType === 'use');
    expect(useIdx).toBeGreaterThan(0);
    const prev = log[useIdx - 1];
    expect(prev.message.skillId).toBe('系统规则');
    expect(prev.message.actionType).toBe('设置手牌顺序');
    expect(prev.message.params.target).toBe(1);
    expect(prev.message.params.order).toEqual(['v1', 'v2', 'v3']);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 盲选超时 → defaultChoice 兜底(明牌优先,无明牌取 hand[0])
  // ─────────────────────────────────────────────────────────────
  it('选牌超时(无明牌)→ 弃掉 hand[0]=v1', async () => {
    await harness.setup(buildState({ p2Hand: ['v1', 'v2', 'v3'] }));
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass(); // 无懈
    await P1.pass(); // 选牌也超时

    expect(harness.state.players[1].hand).toEqual(['v2', 'v3']);
    expect(harness.state.zones.discardPile).toContain('v1');
  });

  // ─────────────────────────────────────────────────────────────
  // 4. 选装备区明牌(zone=equipment)
  // ─────────────────────────────────────────────────────────────
  it('过河拆桥选装备(zone=equipment)→ 弃掉指定装备,手牌不动', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♠', '1', '装备牌');
    await harness.setup(buildState({
      p2Hand: ['v1', 'v2'],
      p2Equip: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    }));
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    await P1.respond('过河拆桥', { zone: 'equipment', cardId: 'wp1' });

    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.players[1].hand).toEqual(['v1', 'v2']);
    expect(harness.state.zones.discardPile).toContain('wp1');
  });

  // ─────────────────────────────────────────────────────────────
  // 5. 选判定区明牌(zone=judge)
  // ─────────────────────────────────────────────────────────────
  it('过河拆桥选判定区(zone=judge)→ 移除延时锦囊+弃置', async () => {
    const lb = makeCard('lb1', '乐不思蜀', '♠', '7');
    const state = buildState({ p2Hand: ['v1'] });
    state.players[1].pendingTricks = [{ name: '乐不思蜀', source: 0, card: lb }];
    state.cardMap['lb1'] = lb;
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    await P1.respond('过河拆桥', { zone: 'judge', cardId: 'lb1' });

    expect(harness.state.players[1].pendingTricks).toHaveLength(0);
    expect(harness.state.zones.discardPile).toContain('lb1');
    expect(harness.state.players[1].hand).toContain('v1');
  });

  // ─────────────────────────────────────────────────────────────
  // 6. 顺手牵羊盲选 → 获得指定手牌
  // ─────────────────────────────────────────────────────────────
  it('顺手牵羊:盲选 handIndex=2 → P1 获得 v3', async () => {
    const state = buildState({ p2Hand: ['v1', 'v2', 'v3'] });
    state.players[0].hand = ['sq1'];
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('顺手牵羊', 'use', { cardId: 'sq1', target: 1 });
    await P1.pass();
    await P1.respond('顺手牵羊', { zone: 'hand', handIndex: 2 });

    expect(harness.state.players[1].hand).toEqual(['v1', 'v2']);
    expect(harness.state.players[0].hand).toContain('v3');
    expect(harness.state.zones.discardPile).toContain('sq1');
  });

  // ─────────────────────────────────────────────────────────────
  // 7. 顺手牵羊选判定区 → 获得延时锦囊
  // ─────────────────────────────────────────────────────────────
  it('顺手牵羊选判定区(zone=judge)→ P1 获得延时锦囊', async () => {
    const lb = makeCard('lb1', '乐不思蜀', '♠', '7');
    const state = buildState({ p2Hand: [] });
    state.players[0].hand = ['sq1'];
    state.players[1].pendingTricks = [{ name: '乐不思蜀', source: 0, card: lb }];
    state.cardMap['lb1'] = lb;
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('顺手牵羊', 'use', { cardId: 'sq1', target: 1 });
    await P1.pass();
    await P1.respond('顺手牵羊', { zone: 'judge', cardId: 'lb1' });

    expect(harness.state.players[1].pendingTricks).toHaveLength(0);
    expect(harness.state.players[0].hand).toContain('lb1');
  });
});
