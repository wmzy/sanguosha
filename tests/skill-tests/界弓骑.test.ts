// 界弓骑(界韩当·吴·主动技)测试(界限突破版):
// 核心机制(OL hero/676 官方逐字):
//   1. 出牌阶段限一次,弃一张牌 → 本回合攻击范围无限 + 同花色杀无次数限制
//   2. 若弃置的牌为装备牌,可弃一名其他角色一张牌
//
// 用例:
//   1. 弃基本牌:设 ACTIVE_VAR + SUIT_VAR;本回合攻击范围无限
//   2. 弃装备牌 + 选择不弃他人牌:设 ACTIVE_VAR + SUIT_VAR(装备花色);无副作用
//   3. 弃装备牌 + 选择弃他人牌:依次 confirm/choosePlayer/pickCard 弃目标一张牌
//   4. 同花色杀无次数限制:发动后,同花色杀不增计杀/usedCount
//   5. 不同花色杀仍占次数:发动后,不同花色杀照常增计
//   6. 攻击范围无限:发动后,远距离目标可被杀(无视武器范围)
//   7. 限一次:第二次发动被拒绝
//   8. 非出牌阶段/非自己回合 → 拒绝
//   9. cardId 不在手牌 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeWeapon(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  range: number,
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype: '武器', range };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界韩当',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界弓骑', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 弃基本牌:设 ACTIVE_VAR + SUIT_VAR;本回合攻击范围无限 ────────────
  it('弃基本牌:设 ACTIVE_VAR + SUIT_VAR;本回合攻击范围无限', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['界弓骑', '杀'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界弓骑', 'use', { cardId: 's1' });

    // ACTIVE_VAR + SUIT_VAR 已设(投影到 turnUsage)
    expect(harness.state.turn.vars['界弓骑/active']).toBe(0);
    expect(harness.state.turn.vars['界弓骑/suit']).toBe('♠');
    // usedThisTurn 标记已设
    expect(harness.state.players[0].vars['界弓骑/usedThisTurn']).toBe(true);
    // 弃置代价牌进入弃牌堆
    expect(harness.state.zones.discardPile).toContain('s1');
    expect(harness.state.players[0].hand).not.toContain('s1');
  });

  // ─── 弃装备牌 + 选不弃他人牌:设标记,无副作用 ────────────
  it('弃装备牌 + 选不弃他人牌:仅设标记', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const slash2 = makeCard('s2', '杀', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['w1', 's2'],
          skills: ['界弓骑', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操', hand: ['x1'] }),
      ],
      cardMap: {
        w1: weapon,
        s2: slash2,
        x1: makeCard('x1', '闪', '♣', '3'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界弓骑', 'use', { cardId: 'w1' });

    // 弃置武器触发 confirm 询问(因 weapon 是装备牌)
    P0.expectPending('请求回应');

    // 选择不弃他人牌
    await P0.respond('界弓骑', { choice: false });

    expect(harness.state.turn.vars['界弓骑/active']).toBe(0);
    expect(harness.state.turn.vars['界弓骑/suit']).toBe('♠');
    // P1 手牌未受影响
    expect(harness.state.players[1].hand).toEqual(['x1']);
  });

  // ─── 弃装备牌 + 选弃他人牌:依次 confirm/choosePlayer/pickCard ────────────
  it('弃装备牌 + 选弃他人牌:依次 confirm/choosePlayer/pickCard', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const targetEquip = makeWeapon('w2', '诸葛连弩', '♥', 1);
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['w1'],
          skills: ['界弓骑'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['x1'],
          equipment: { 武器: 'w2' },
        }),
      ],
      cardMap: {
        w1: weapon,
        w2: targetEquip,
        x1: makeCard('x1', '闪', '♣', '3'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界弓骑', 'use', { cardId: 'w1' });

    // 1. confirm 询问是否弃他人牌
    P0.expectPending('请求回应');
    await P0.respond('界弓骑', { choice: true });

    // 2. choosePlayer 选目标
    P0.expectPending('请求回应');
    await P0.respond('界弓骑', { target: 1 });

    // 3. pickTargetCard 选具体牌
    P0.expectPending('请求回应');
    await P0.respond('界弓骑', { zone: 'equipment', cardId: 'w2' });

    // P1 的武器被弃
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w2');
  });

  // ─── 同花色杀无次数限制:发动后,同花色杀不增计杀/usedCount ────────────
  it('同花色杀不增计杀/usedCount(发动弓骑后)', async () => {
    // P0 弃 ♠ 牌发动弓骑,再用 ♠ 杀 P1,不增计
    const discard = makeCard('d1', '闪', '♠', '3');
    const slash = makeCard('s1', '杀', '♠', '7');
    const dodge = makeCard('x1', '闪', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['d1', 's1'],
          skills: ['界弓骑', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操', hand: ['x1'] }),
      ],
      cardMap: { d1: discard, s1: slash, x1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 弃 ♠ 牌发动弓骑
    await P0.triggerAction('界弓骑', 'use', { cardId: 'd1' });
    expect(harness.state.turn.vars['界弓骑/suit']).toBe('♠');

    // 出 ♠ 杀(同花色,不应增计)
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass(); // 不出闪

    expect(harness.state.players[1].health).toBe(3); // 杀生效
    // 同花色杀不增计杀/usedCount
    expect(harness.state.turn.vars['杀/usedCount']).toBeUndefined();
  });

  // ─── 不同花色杀仍占次数 ────────────────────
  it('不同花色杀仍增计杀/usedCount', async () => {
    // P0 弃 ♠ 牌发动弓骑,再用 ♥ 杀 P1,应增计
    const discard = makeCard('d1', '闪', '♠', '3');
    const slash = makeCard('s1', '杀', '♥', '7');
    const dodge = makeCard('x1', '闪', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['d1', 's1'],
          skills: ['界弓骑', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操', hand: ['x1'] }),
      ],
      cardMap: { d1: discard, s1: slash, x1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 弃 ♠ 牌发动弓骑
    await P0.triggerAction('界弓骑', 'use', { cardId: 'd1' });
    expect(harness.state.turn.vars['界弓骑/suit']).toBe('♠');

    // 出 ♥ 杀(不同花色,应增计)
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);
  });

  // ─── 攻击范围无限:远距离目标可被杀 ────────────
  it('攻击范围无限:远距离目标可被杀', async () => {
    // 4 人局:座位 0,1,2,3。徒手范围 1,只能杀相邻(1,3)。
    // P0 弃牌发动弓骑后,可杀距离 2 的 P2。
    const discard = makeCard('d1', '闪', '♠', '3');
    const slash = makeCard('s1', '杀', '♥', '7');
    const dodge1 = makeCard('x1', '闪', '♣', '5');
    const dodge2 = makeCard('x2', '闪', '♣', '6');
    const dodge3 = makeCard('x3', '闪', '♣', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['d1', 's1'],
          skills: ['界弓骑', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操', hand: ['x1'] }),
        makePlayer({ index: 2, name: 'P2', character: '刘备', hand: ['x2'] }),
        makePlayer({ index: 3, name: 'P3', character: '孙权', hand: ['x3'] }),
      ],
      cardMap: { d1: discard, s1: slash, x1: dodge1, x2: dodge2, x3: dodge3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');

    // 弃 ♠ 牌发动弓骑
    await P0.triggerAction('界弓骑', 'use', { cardId: 'd1' });

    // 现在可对距离 2 的 P2 出杀(攻击范围无限)
    await P0.useCardAndTarget('杀', 's1', [2]);
    await P2.pass();

    expect(harness.state.players[2].health).toBe(3); // 杀生效
  });

  // ─── 限一次:第二次发动被拒绝 ────────────
  it('限一次:第二次发动被拒绝', async () => {
    const card1 = makeCard('d1', '闪', '♠', '3');
    const card2 = makeCard('d2', '杀', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['d1', 'd2'],
          skills: ['界弓骑'],
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { d1: card1, d2: card2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界弓骑', 'use', { cardId: 'd1' });

    // 第二次:拒绝
    await P0.expectRejected({
      skillId: '界弓骑',
      actionType: 'use',
      params: { cardId: 'd2' },
    });
  });

  // ─── 非出牌阶段/非自己回合 → 拒绝 ────────────
  it('非自己回合:拒绝', async () => {
    const card1 = makeCard('d1', '闪', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['d1'], skills: ['界弓骑'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { d1: card1 },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界弓骑',
      actionType: 'use',
      params: { cardId: 'd1' },
    });
  });

  // ─── cardId 不在手牌 → 拒绝 ────────────
  it('cardId 不在手牌:拒绝', async () => {
    const card1 = makeCard('d1', '闪', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界弓骑'] }), // 无手牌
        makePlayer({ index: 1, name: 'P1', character: '曹操', hand: ['d1'] }),
      ],
      cardMap: { d1: card1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界弓骑',
      actionType: 'use',
      params: { cardId: 'd1' }, // 不在 P0 手牌
    });
  });
});
