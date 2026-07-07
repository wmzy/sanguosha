// 枭姬(孙尚香·被动技)测试:
//   当你失去一张装备区的牌时,你可以摸两张牌。
//
// 覆盖三条装备流失路径 + 发动/不发动:
//   1. 卸下(自己替换装备):装新武器替换旧武器 → 触发 → 确认 → 摸2张
//   2. 弃置(过河拆桥拆装备):他人拆我装备 → 触发 → 确认 → 摸2张
//   3. 获得(顺手牵羊顺装备):他人顺我装备 → 触发 → 确认 → 摸2张
//   4. 不发动:替换装备 → 拒绝 → 不摸牌
//   5. 负面:过河拆桥拆的是手牌(非装备)→ 不触发枭姬
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeEquip(
  id: string,
  name: string,
  subtype: '武器' | '防具' | '进攻马' | '防御马' | '宝物',
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  range?: number,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype, range };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  vars?: Record<string, Json>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '孙尚香',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('枭姬', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 卸下(自己替换装备)→ 触发 → 确认 → 摸2张 ────────────
  it('替换装备:装新武器替换旧武器 → 确认发动 → 摸2张', async () => {
    const deckIds = ['d1', 'd2'];
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙尚香',
          hand: ['w2'],
          equipment: { 武器: 'w1' },
          skills: ['枭姬', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        w2: makeEquip('w2', '测试剑乙', '武器', '♥', 'A', 3),
        d1: makeCard('d1', '闪', '♦', '2'),
        d2: makeCard('d2', '杀', '♠', '3'),
      },
      zones: { deck: [...deckIds], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('孙尚香');

    // 装新武器替换旧武器
    await P0.useCard('装备通用', 'w2');
    // 替换触发枭姬 → 弹出确认窗口
    P0.expectPending('请求回应');

    // 确认发动
    await P0.respond('枭姬', { choice: true });

    // 摸了 2 张(d1, d2);w2 已用于装备,w1 进弃牌堆
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.deck.length).toBe(0);
    // 旧武器进弃牌堆
    expect(harness.state.zones.discardPile).toContain('w1');
    // 新武器占位
    expect(harness.state.players[0].equipment['武器']).toBe('w2');
  });

  // ─── 2. 弃置(过河拆桥拆装备)→ 触发 → 确认 → 摸2张 ──────────
  it('过河拆桥拆我装备 → 确认发动 → 摸2张', async () => {
    const deckIds = ['d1', 'd2'];
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙尚香',
          hand: [],
          equipment: { 武器: 'w1' },
          skills: ['枭姬'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['gq1'],
          skills: ['过河拆桥'],
        }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        gq1: makeCard('gq1', '过河拆桥', '♠', 'A', '锦囊牌'),
        d1: makeCard('d1', '闪', '♦', '2'),
        d2: makeCard('d2', '杀', '♠', '3'),
      },
      zones: { deck: [...deckIds], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('孙尚香');

    // P1 对孙尚香出过河拆桥
    await P1.useCardAndTarget('过河拆桥', 'gq1', [0]);
    // 无懈窗口:无人打无懈
    await P1.pass();
    // 选牌面板:P1 选装备(zone=equipment, cardId=w1)
    await P1.respond('过河拆桥', { zone: 'equipment', cardId: 'w1' });
    // 枭姬触发 → 确认窗口(目标=孙尚香)
    P0.expectPending('请求回应');
    await P0.respond('枭姬', { choice: true });

    // 摸了 2 张
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.deck.length).toBe(0);
    // 武器被拆(进弃牌堆)
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
  });

  // ─── 3. 获得(顺手牵羊顺装备)→ 触发 → 确认 → 摸2张 ──────────
  it('顺手牵羊顺我装备 → 确认发动 → 摸2张', async () => {
    const deckIds = ['d1', 'd2'];
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙尚香',
          hand: [],
          equipment: { 武器: 'w1' },
          skills: ['枭姬'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['sq1'],
          skills: ['顺手牵羊'],
        }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        sq1: makeCard('sq1', '顺手牵羊', '♠', 'A', '锦囊牌'),
        d1: makeCard('d1', '闪', '♦', '2'),
        d2: makeCard('d2', '杀', '♠', '3'),
      },
      zones: { deck: [...deckIds], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('孙尚香');

    // P1 对孙尚香出顺手牵羊(2 人相邻,距离 1)
    await P1.useCardAndTarget('顺手牵羊', 'sq1', [0]);
    await P1.pass();
    // 选牌面板:P1 选装备
    await P1.respond('顺手牵羊', { zone: 'equipment', cardId: 'w1' });
    // 枭姬触发
    P0.expectPending('请求回应');
    await P0.respond('枭姬', { choice: true });

    // 摸了 2 张
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.deck.length).toBe(0);
    // 武器被 P1 获得
    expect(harness.state.players[1].hand).toContain('w1');
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
  });

  // ─── 4. 不发动:替换装备 → 拒绝 → 不摸牌 ──────────────────
  it('替换装备 → 拒绝发动 → 不摸牌', async () => {
    const deckIds = ['d1', 'd2'];
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙尚香',
          hand: ['w2'],
          equipment: { 武器: 'w1' },
          skills: ['枭姬', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        w2: makeEquip('w2', '测试剑乙', '武器', '♥', 'A', 3),
        d1: makeCard('d1', '闪', '♦', '2'),
        d2: makeCard('d2', '杀', '♠', '3'),
      },
      zones: { deck: [...deckIds], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('孙尚香');

    await P0.useCard('装备通用', 'w2');
    P0.expectPending('请求回应');
    // 拒绝发动
    await P0.respond('枭姬', { choice: false });

    // 未摸牌(w2 已装备,手牌为空)
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.zones.deck.length).toBe(2);
  });

  // ─── 5. 负面:过河拆桥拆的是手牌(非装备)→ 不触发枭姬 ──────
  it('过河拆桥拆手牌 → 不触发枭姬(无确认窗口)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙尚香',
          hand: ['p1', 'p2'],
          equipment: { 武器: 'w1' },
          skills: ['枭姬'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['gq1'],
          skills: ['过河拆桥'],
        }),
      ],
      cardMap: {
        w1: makeEquip('w1', '测试剑甲', '武器', '♠', 'A', 2),
        p1: makeCard('p1', '闪', '♦', '2'),
        p2: makeCard('p2', '杀', '♠', '3'),
        gq1: makeCard('gq1', '过河拆桥', '♠', 'A', '锦囊牌'),
      },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [0]);
    await P1.pass();
    // P1 选手牌(盲选第 0 张)
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 0 });

    // 枭姬不应触发:无 pending,孙尚香手牌仅因被拆减 1(无摸牌)
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(1);
    // 装备仍在
    expect(harness.state.players[0].equipment['武器']).toBe('w1');
  });
});
