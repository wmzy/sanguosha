// 奇制 + 进趋(王基·魏·被动技,OL hero/362 风林火山)测试:
//   奇制:当你于回合内使用非装备牌指定目标后,你可以弃置另一名角色一张牌,然后令其摸一张牌。
//   进趋:结束阶段,你可以摸两张牌,然后将手牌弃至X张(X为你本回合发动"奇制"的次数)。
//
// 验证:
//   奇制:
//     1. 发动:使用杀指定目标后 → confirm → 选另一名角色 → 弃其一张手牌 → 其摸一张 → 计数+1
//     2. 弃装备:选目标的装备区牌弃置
//     3. 不发动:confirm=false → 无效果,计数不变
//     4. 无可弃目标:其他角色均无牌 → 不触发
//   进趋:
//     5. X=2:摸2后弃至2张
//     6. X=0:摸2后弃光全部手牌
//     7. 不发动:confirm=false → 不摸不弃
//     8. 奇制+进趋联动:发动奇制后进趋 X=1
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
// 临时注册奇制/进趋(主 agent 会统一注册到 index.ts)
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import * as 奇制Module from '../../src/engine/skills/奇制';
import * as 进趋Module from '../../src/engine/skills/进趋';
setSkillModuleOverride('奇制', async () => 奇制Module);
setSkillModuleOverride('进趋', async () => 进趋Module);

import { suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
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
  health?: number;
  maxHealth?: number;
  equipment?: PlayerState['equipment'];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
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

/** 当前 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return null;
  return (slots[0].atom as unknown as { requestType?: string }).requestType ?? null;
}

// ════════════════════════════════════════════════════════════════
// 奇制
// ════════════════════════════════════════════════════════════════
describe('奇制', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 发动:弃他人手牌 → 其摸一张 → 计数+1 ────────────────
  it('发动奇制:弃 P2 手牌 → P2 摸一张 → 计数+1', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const p2card = makeCard('p2c', '桃', '♦', '3');
    const drawn = makeCard('d1', '闪', '♥', '5'); // P2 摸的牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '王基', hand: ['k1'], skills: ['奇制', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
        makePlayer({ index: 2, name: 'P2', hand: ['p2c'], skills: [] }),
      ],
      cardMap: { k1: slash, p2c: p2card, d1: drawn },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('王基');

    const restoreAutoCompare = disableAutoCompare();

    // 王基对 P1 出杀 → 指定目标后 → 奇制 confirm
    await P0.useCardAndTarget('杀', 'k1', [1]);
    expect(currentRequestType(harness.state)).toBe('奇制/confirm');

    // 确认发动
    await P0.respond('奇制', { choice: true });
    expect(currentRequestType(harness.state)).toBe('奇制/选目标');

    // 选 P2(另一名角色)
    await P0.respond('奇制', { target: 2 });
    expect(currentRequestType(harness.state)).toBe('奇制/选牌');

    // 弃 P2 手牌(盲选 handIndex 0 = p2c)
    await P0.respond('奇制', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();

    // P2 的桃被弃置 → 进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p2c');
    // P2 摸了一张(从牌堆顶 d1)
    expect(harness.state.players[2].hand).toEqual(['d1']);
    // 奇制计数 = 1
    expect(harness.state.turn.vars['奇制/count']).toBe(1);

    // 杀继续结算:P1 无手牌 → 询问闪自动 skip → P1 受 1 伤
    await harness.waitForStable();
    expect(harness.state.players[1].health).toBe(3);

    restoreAutoCompare();
  });

  // ─── 2. 弃装备:选目标的装备区牌 ────────────────────────────
  it('发动奇制:弃 P2 装备区牌', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const weapon = makeCard('w1', '诸葛连弩', '♣', 'A', '装备牌');
    const drawn = makeCard('d1', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '王基', hand: ['k1'], skills: ['奇制', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
          equipment: { 武器: 'w1' },
        }),
      ],
      cardMap: { k1: slash, w1: weapon, d1: drawn },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('王基');

    const restoreAutoCompare = disableAutoCompare();

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P0.respond('奇制', { choice: true });
    await P0.respond('奇制', { target: 2 });
    // 选装备区的武器(明选)
    await P0.respond('奇制', { zone: 'equipment', cardId: 'w1' });
    await harness.waitForStable();

    // P2 的武器被弃置
    expect(harness.state.players[2].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
    // P2 摸了一张
    expect(harness.state.players[2].hand).toEqual(['d1']);
    expect(harness.state.turn.vars['奇制/count']).toBe(1);

    restoreAutoCompare();
  });

  // ─── 3. 不发动:confirm=false → 无效果 ────────────────────────
  it('不发动奇制:无弃牌无摸牌,计数不变', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const p2card = makeCard('p2c', '桃', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '王基', hand: ['k1'], skills: ['奇制', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
        makePlayer({ index: 2, name: 'P2', hand: ['p2c'], skills: [] }),
      ],
      cardMap: { k1: slash, p2c: p2card },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('王基');

    const restoreAutoCompare = disableAutoCompare();

    await P0.useCardAndTarget('杀', 'k1', [1]);
    expect(currentRequestType(harness.state)).toBe('奇制/confirm');

    // 不发动
    await P0.respond('奇制', { choice: false });
    await harness.waitForStable();

    // 无弃牌、无摸牌
    expect(harness.state.players[2].hand).toEqual(['p2c']);
    expect(harness.state.zones.discardPile).not.toContain('p2c');
    // 计数未设(仍为 undefined)
    expect(harness.state.turn.vars['奇制/count']).toBeUndefined();
    // P1 受杀 1 伤
    expect(harness.state.players[1].health).toBe(3);

    restoreAutoCompare();
  });

  // ─── 4. 无可弃目标:其他角色均无牌 → 不触发 ────────────────────
  it('无可弃目标:其他角色均无牌 → 不触发奇制', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '王基', hand: ['k1'], skills: ['奇制', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: [], equipment: {} }),
      ],
      cardMap: { k1: slash },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('王基');

    const restoreAutoCompare = disableAutoCompare();

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await harness.waitForStable();

    // P1/P2 均无牌 → 奇制不触发(无 confirm pending)
    expect(currentRequestType(harness.state)).not.toBe('奇制/confirm');
    // P1 受杀 1 伤(杀正常结算)
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.turn.vars['奇制/count']).toBeUndefined();

    restoreAutoCompare();
  });

  // ─── 5. 多目标:杀指定目标后逐目标触发(此处验证 count 累加) ───
  //   注:标杀只能指定 1 目标,此处验证一次发动后 count 正确;进趋联动见进趋 describe。
  it('奇制发动后 turn.vars 奇制/count 正确累加(2 次出杀)', async () => {
    const slash1 = makeCard('k1', '杀', '♠', '7');
    const slash2 = makeCard('k2', '杀', '♠', '8');
    const p2c1 = makeCard('p2a', '桃', '♦', '3');
    const p2c2 = makeCard('p2b', '桃', '♦', '4');
    const d1 = makeCard('d1', '闪', '♥', '5');
    const d2 = makeCard('d2', '闪', '♥', '6');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '王基',
          hand: ['k1', 'k2'],
          skills: ['奇制', '杀', '诸葛连弩'],
          equipment: { 武器: 'wn' },
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
        makePlayer({ index: 2, name: 'P2', hand: ['p2a', 'p2b'], skills: [] }),
      ],
      cardMap: {
        k1: slash1,
        k2: slash2,
        p2a: p2c1,
        p2b: p2c2,
        d1,
        d2,
        wn: makeCard('wn', '诸葛连弩', '♣', 'A', '装备牌'),
      },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // 手动补齐攻击范围(初始装备不走 atom)
    state.players[0].vars['距离/出杀范围'] = 1;
    await harness.setup(state);
    const P0 = harness.player('王基');

    const restoreAutoCompare = disableAutoCompare();

    // 第一次出杀
    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P0.respond('奇制', { choice: true });
    await P0.respond('奇制', { target: 2 });
    await P0.respond('奇制', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();
    expect(harness.state.turn.vars['奇制/count']).toBe(1);

    // 第二次出杀(诸葛连弩无限出杀)
    await P0.useCardAndTarget('杀', 'k2', [1]);
    await P0.respond('奇制', { choice: true });
    await P0.respond('奇制', { target: 2 });
    await P0.respond('奇制', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();
    expect(harness.state.turn.vars['奇制/count']).toBe(2);

    restoreAutoCompare();
  });
});

// ════════════════════════════════════════════════════════════════
// 进趋
// ════════════════════════════════════════════════════════════════
describe('进趋', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 5. X=2:摸2后弃至2张 ────────────────────────────────────
  it('进趋 X=2:摸两张 → 弃至 2 张', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const d1 = makeCard('d1', '桃', '♦', '4');
    const d2 = makeCard('d2', '酒', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '王基',
          hand: ['c1', 'c2'],
          skills: ['奇制', '进趋', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { c1, c2, d1, d2 },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      // 预设奇制发动 2 次
      turn: { round: 1, phase: '出牌', vars: { '奇制/count': 2 } },
    });
    await harness.setup(state);
    const P0 = harness.player('王基');

    const restoreAutoCompare = disableAutoCompare();

    // 结束出牌阶段 → 弃牌阶段(2 ≤ 上限3,无需弃)→ 回合结束 → 进趋 confirm
    await P0.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    expect(currentRequestType(harness.state)).toBe('进趋/confirm');

    // 确认发动 → 摸 2 张(手牌 4)→ 弃至 2(弃 2)
    await P0.respond('进趋', { choice: true });
    await harness.waitForStable();
    expect(harness.state.players[0].hand.length).toBe(4); // 2+2 摸
    expect(currentRequestType(harness.state)).toBe('进趋/弃牌');

    // 弃 2 张(选前两张)
    const discardCards = harness.state.players[0].hand.slice(0, 2);
    await P0.respond('进趋', { cardIds: discardCards });
    await harness.waitForStable();

    // 最终手牌 2 张
    expect(harness.state.players[0].hand.length).toBe(2);

    restoreAutoCompare();
  });

  // ─── 6. X=0:摸2后弃光全部手牌 ────────────────────────────────
  it('进趋 X=0(未发动奇制):摸两张 → 弃光全部手牌', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const d1 = makeCard('d1', '桃', '♦', '4');
    const d2 = makeCard('d2', '酒', '♣', '5');
    // 额外牌堆牌:进趋摸空牌堆后,P1 回合摸牌不触发重洗(避免清空弃牌堆)
    const e1 = makeCard('e1', '杀', '♠', '9');
    const e2 = makeCard('e2', '闪', '♥', '10');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '王基',
          hand: ['c1', 'c2'],
          skills: ['奇制', '进趋', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { c1, c2, d1, d2, e1, e2 },
      zones: { deck: ['d1', 'd2', 'e1', 'e2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      // 未发动奇制 → X=0
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('王基');

    const restoreAutoCompare = disableAutoCompare();

    await P0.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    expect(currentRequestType(harness.state)).toBe('进趋/confirm');

    // 确认发动 → 摸 2(手牌 4)→ 弃至 0(弃 4)
    await P0.respond('进趋', { choice: true });
    await harness.waitForStable();
    expect(harness.state.players[0].hand.length).toBe(4);
    expect(currentRequestType(harness.state)).toBe('进趋/弃牌');

    // 弃全部 4 张
    const allCards = [...harness.state.players[0].hand];
    await P0.respond('进趋', { cardIds: allCards });
    await harness.waitForStable();

    // 手牌清空
    expect(harness.state.players[0].hand.length).toBe(0);
    // 4 张全进弃牌堆
    for (const id of allCards) {
      expect(harness.state.zones.discardPile).toContain(id);
    }

    restoreAutoCompare();
  });

  // ─── 7. 不发动:confirm=false → 不摸不弃 ────────────────────────
  it('不发动进趋:不摸牌不弃牌', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '王基',
          hand: ['c1', 'c2'],
          skills: ['奇制', '进趋', '回合管理'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { c1, c2 },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: { '奇制/count': 2 } },
    });
    await harness.setup(state);
    const P0 = harness.player('王基');

    const restoreAutoCompare = disableAutoCompare();

    await P0.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    expect(currentRequestType(harness.state)).toBe('进趋/confirm');

    // 不发动
    await P0.respond('进趋', { choice: false });
    await harness.waitForStable();

    // 手牌不变(2 张),未摸牌
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).toEqual(['c1', 'c2']);

    restoreAutoCompare();
  });

  // ─── 8. 奇制+进趋联动:发动奇制1次后进趋 X=1 ────────────────────
  it('联动:发动奇制1次 → 进趋 X=1(摸2弃至1)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const p2c = makeCard('p2c', '桃', '♦', '3');
    const d1 = makeCard('d1', '闪', '♥', '5'); // 奇制令 P2 摸
    // 进趋摸的 2 张
    const jd1 = makeCard('jd1', '杀', '♠', '2');
    const jd2 = makeCard('jd2', '闪', '♥', '3');
    const keep = makeCard('kp', '桃', '♦', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '王基',
          hand: ['k1', 'kp'],
          skills: ['奇制', '进趋', '回合管理', '杀'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['回合管理'] }),
        makePlayer({ index: 2, name: 'P2', hand: ['p2c'], skills: [] }),
      ],
      cardMap: { k1: slash, p2c, d1, jd1, jd2, kp: keep },
      // 牌堆:奇制摸1(d1) + 进趋摸2(jd1,jd2)
      zones: { deck: ['d1', 'jd1', 'jd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('王基');

    const restoreAutoCompare = disableAutoCompare();

    // 王基对 P1 出杀 → 奇制:弃 P2 一张 → P2 摸1 → count=1
    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P0.respond('奇制', { choice: true });
    await P0.respond('奇制', { target: 2 });
    await P0.respond('奇制', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();
    expect(harness.state.turn.vars['奇制/count']).toBe(1);
    // 王基出杀后剩 kp(1 张)
    expect(harness.state.players[0].hand).toEqual(['kp']);

    // 结束回合 → 弃牌(1 ≤ 3,无需弃)→ 回合结束 → 进趋 X=1
    await P0.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    expect(currentRequestType(harness.state)).toBe('进趋/confirm');

    // 发动进趋:摸2(kp+jd1+jd2=3张)→ 弃至 1(弃2)
    await P0.respond('进趋', { choice: true });
    await harness.waitForStable();
    expect(harness.state.players[0].hand.length).toBe(3);
    expect(currentRequestType(harness.state)).toBe('进趋/弃牌');

    // 弃 2 张
    const discardCards = harness.state.players[0].hand.slice(0, 2);
    await P0.respond('进趋', { cardIds: discardCards });
    await harness.waitForStable();

    // 最终手牌 1 张(X=1)
    expect(harness.state.players[0].hand.length).toBe(1);

    restoreAutoCompare();
  });
});
