// 界渐营(界沮授·群·被动技)测试:
// 核心规则(OL 界限突破官方逐字):
//   当你于出牌阶段使用牌时,若此牌与你于此阶段使用的上一张牌花色或点数相同,
//   则你可以摸一张牌。出牌阶段限一次,你可以将一张牌当做任意一张基本牌使用,
//   若你于本阶段使用的上一张牌有花色,则此牌的花色视为与上一张牌的花色相同。
//
// 用例:
//   1. 同花色:杀♠7 → 桃♠3(自伤 P0)→ 询问 → 确认 → 摸一张
//   2. 同点数:杀♠3 → 桃♥3(自伤 P0)→ 询问摸牌
//   3. 不同花色点数:不询问
//   4. 阶段首张牌:无"上一张",不询问
//   5. 拒绝摸牌:不摸牌,但"上一张牌"仍更新
//   6. 装备牌也计入"使用牌"(触发追踪)
//   7. 第二段 transform:基本转化 → 转化为杀使用(命中目标)
//   8. 第二段限一次:本阶段第二次被拒绝
//   9. 第二段花色继承:上一张有花色 → 转化卡视为同花色(transform 单独触发,验证影子)
//  10. 第二段无上一张:不继承花色(影子卡保留源卡花色)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

const LAST_SUIT_KEY = '界渐营/lastSuit';
const LAST_RANK_KEY = '界渐营/lastRank';
const TRANSFORM_USED_KEY = '界渐营/transformUsedThisTurn';

function suitColor(suit: '♠' | '♥' | '♣' | '♦'): '红' | '黑' {
  return suit === '♥' || suit === '♦' ? '红' : '黑';
}

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
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界沮授',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    // 默认包含主技能 + 基本牌/装备/系统技能(以便转化目标能结算)
    skills: opts.skills ?? ['界渐营', '杀', '闪', '桃', '酒', '装备通用'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function lastSuit(state: GameState): string {
  const v = state.turn.vars[LAST_SUIT_KEY];
  return typeof v === 'string' ? v : '';
}

function lastRank(state: GameState): string {
  const v = state.turn.vars[LAST_RANK_KEY];
  return typeof v === 'string' ? v : '';
}

function transformUsed(state: GameState, ownerId: number): boolean {
  return !!state.players[ownerId]?.vars[TRANSFORM_USED_KEY];
}

describe('界渐营', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 同花色:杀♠7 → 桃♠3(自伤 P0)→ 询问 → 确认 → 摸一张 ────
  it('同花色(♠→♠):询问 → 确认 → 摸一张', async () => {
    const c1 = makeCard('c1', '杀', '♠', '7');
    const c2 = makeCard('c2', '桃', '♠', '3');
    const state: GameState = createGameState({
      players: [
        // P0 health=2(受伤,可用桃自回血)
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], health: 2 }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 用第一张:杀 ♠7(目标 P1;P1 不出闪)
    await P0.useCardAndTarget('杀', 'c1', [1]);
    await harness.player(1).pass();

    expect(lastSuit(harness.state)).toBe('♠');
    expect(lastRank(harness.state)).toBe('7');

    const handBefore = harness.state.players[0].hand.length;

    // 用第二张:桃 ♠3(目标自己 P0)→ 同花色 ♠ → 询问摸牌
    await P0.useCardAndTarget('桃', 'c2', [0]);
    P0.expectPending('请求回应');
    await P0.respond('界渐营', { choice: true });

    // 摸一张(数量 +1,扣除用掉的桃 -1,净 0)
    expect(harness.state.players[0].hand.length).toBe(handBefore);
    // "上一张"已更新为第二张
    expect(lastSuit(harness.state)).toBe('♠');
    expect(lastRank(harness.state)).toBe('3');
  });

  // ─── 2. 同点数:杀♠3 → 桃♥3(自回血)→ 询问摸牌 ────────────────────
  it('同点数(♠3→♥3):询问摸牌', async () => {
    const c1 = makeCard('c1', '杀', '♠', '3');
    const c2 = makeCard('c2', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], health: 2 }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCardAndTarget('杀', 'c1', [1]);
    await harness.player(1).pass();

    // 桃 ♥3(同点数 3)→ 询问
    await P0.useCardAndTarget('桃', 'c2', [0]);
    P0.expectPending('请求回应');
    await P0.respond('界渐营', { choice: true });

    // 渐营触发 → 摸 1 张;桃用掉 -1 + 摸 1 = 净 0(初始 2 张)
    expect(harness.state.players[0].hand.length).toBe(1); // 2 - 用桃 + 摸 1 = 2... 实际杀用掉 1 + 桃用掉 1 + 摸 1 = 1
  });

  // ─── 3. 不同花色点数:不询问,"上一张"仍更新 ────────────────────
  it('不同花色点数:不询问,"上一张"仍更新', async () => {
    const c1 = makeCard('c1', '杀', '♠', '7');
    const c2 = makeCard('c2', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], health: 2 }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCardAndTarget('杀', 'c1', [1]);
    await harness.player(1).pass();

    await P0.useCardAndTarget('桃', 'c2', [0]);

    // 不应触发询问
    expect(harness.state.pendingSlots.size).toBe(0);
    // "上一张"已更新为第二张
    expect(lastSuit(harness.state)).toBe('♥');
    expect(lastRank(harness.state)).toBe('3');
  });

  // ─── 4. 阶段首张牌:无"上一张",不询问 ────────────────────
  it('阶段首张牌:不询问', async () => {
    const c1 = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCardAndTarget('杀', 'c1', [1]);
    await harness.player(1).pass();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(lastSuit(harness.state)).toBe('♠');
  });

  // ─── 5. 拒绝摸牌:不摸牌,但"上一张牌"仍更新 ────────────────────
  it('拒绝摸牌:不摸牌,"上一张"仍更新', async () => {
    const c1 = makeCard('c1', '杀', '♠', '7');
    const c2 = makeCard('c2', '桃', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], health: 2 }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCardAndTarget('杀', 'c1', [1]);
    await harness.player(1).pass();

    const handBefore = harness.state.players[0].hand.length;

    // 用桃(同花色 ♠ → 询问)
    await P0.useCardAndTarget('桃', 'c2', [0]);
    P0.expectPending('请求回应');
    await P0.respond('界渐营', { choice: false }); // 拒绝

    // 未摸牌,手牌 -1(用掉的桃)
    expect(harness.state.players[0].hand.length).toBe(handBefore - 1);
    expect(lastSuit(harness.state)).toBe('♠');
    expect(lastRank(harness.state)).toBe('3');
  });

  // ─── 6. 装备牌也计入"使用牌"(触发追踪) ────────────────────
  it('装备牌计入使用牌:同花色装备后用杀 → 询问摸牌', async () => {
    const restoreAutoCompare = disableAutoCompare();
    try {
      // ♣ 武器 + ♣ 杀(同花色)
      const w1 = makeWeapon('w1', '诸葛连弩', '♣', 1, 'A');
      const c2 = makeCard('c2', '杀', '♣', '5');
      const state: GameState = createGameState({
        players: [
          makePlayer({ index: 0, name: 'P0', hand: ['w1', 'c2'] }),
          makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: { w1: w1, c2 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      });
      await harness.setup(state);
      const P0 = harness.player('P0');

      // 装备诸葛连弩(♣A)→ 触发 hook,lastSuit=♣
      await P0.triggerAction('装备通用', 'use', { cardId: 'w1' });
      expect(lastSuit(harness.state)).toBe('♣');
      expect(lastRank(harness.state)).toBe('A');

      // 用杀 ♣5 → 同花色 → 询问
      await P0.useCardAndTarget('杀', 'c2', [1]);
      P0.expectPending('请求回应');
      await P0.respond('界渐营', { choice: true });

      expect(lastSuit(harness.state)).toBe('♣');
      expect(lastRank(harness.state)).toBe('5');
    } finally {
      restoreAutoCompare();
    }
  });

  // ─── 7. 第二段 transform:基本转化 → 转化为杀使用(命中目标) ────
  it('transform:将一张牌当杀使用(命中目标)', async () => {
    const restoreAutoCompare = disableAutoCompare();
    try {
      const src = makeCard('c1', '杀', '♠', '7');
      const state: GameState = createGameState({
        players: [
          makePlayer({ index: 0, name: 'P0', hand: ['c1'] }),
          makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: { c1: src },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      });
      await harness.setup(state);
      const P0 = harness.player('P0');

      await P0.transformThenUse(
        '界渐营',
        { cardId: 'c1', outputName: '杀' },
        '杀',
        { cardId: 'c1#界渐营', targets: [1] },
      );
      await harness.player(1).pass();

      // 杀命中:P1 受 1 伤(3→2)
      expect(harness.state.players[1].health).toBe(2);
      expect(transformUsed(harness.state, 0)).toBe(true);
      // 阶段首张(转化卡)= "上一张"
      expect(lastSuit(harness.state)).toBe('♠');
    } finally {
      restoreAutoCompare();
    }
  });

  // ─── 8. 第二段限一次:本阶段第二次被拒绝 ────────────────────
  it('transform 限一次:第二次被拒绝', async () => {
    const src1 = makeCard('c1', '杀', '♠', '7');
    const src2 = makeCard('c2', '杀', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: src1, c2: src2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 第一次:转化 + 使用
    await P0.transformThenUse(
      '界渐营',
      { cardId: 'c1', outputName: '杀' },
      '杀',
      { cardId: 'c1#界渐营', targets: [1] },
    );
    await harness.player(1).pass();
    expect(transformUsed(harness.state, 0)).toBe(true);

    // 第二次:仅触发 transform 应被拒绝
    await P0.expectRejected({
      skillId: '界渐营',
      actionType: 'transform',
      params: { cardId: 'c2', outputName: '杀' },
    });
  });

  // ─── 9. 第二段花色继承:上一张有花色 → 转化卡视为同花色 ────────────────────
  it('transform 花色继承:上一张♥ → 转化卡视为♥', async () => {
    const restoreAutoCompare = disableAutoCompare();
    try {
      // 第一张:♥3 杀(建立 lastSuit=♥)
      const first = makeCard('f1', '杀', '♥', '3');
      // 第二张:用 ♣7 转化为杀,应继承 ♥ 花色
      const src = makeCard('s1', '杀', '♣', '7');
      const state: GameState = createGameState({
        players: [
          makePlayer({ index: 0, name: 'P0', hand: ['f1', 's1'] }),
          makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: { f1: first, s1: src },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      });
      await harness.setup(state);
      const P0 = harness.player('P0');

      // 用第一张杀(♥3)→ lastSuit=♥
      await P0.useCardAndTarget('杀', 'f1', [1]);
      await harness.player(1).pass();
      expect(lastSuit(harness.state)).toBe('♥');

      // 单独触发 transform(不 use)→ 检查影子卡花色
      await P0.triggerAction('界渐营', 'transform', {
        cardId: 's1',
        outputName: '杀',
      });

      // 验证影子卡被 override 为 ♥
      const shadow = harness.state.cardMap['s1#界渐营'];
      expect(shadow).toBeDefined();
      expect(shadow.suit).toBe('♥');
      expect(shadow.color).toBe('红');
    } finally {
      restoreAutoCompare();
    }
  });

  // ─── 10. 第二段无上一张:不继承花色,保留源卡花色 ────────────────────
  it('transform 无上一张:不继承花色,保留源卡花色', async () => {
    const restoreAutoCompare = disableAutoCompare();
    try {
      const src = makeCard('c1', '杀', '♣', '7');
      const state: GameState = createGameState({
        players: [
          makePlayer({ index: 0, name: 'P0', hand: ['c1'] }),
          makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: { c1: src },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      });
      await harness.setup(state);
      const P0 = harness.player('P0');

      // 阶段首张即转化:无上一张 → 不继承
      await P0.triggerAction('界渐营', 'transform', {
        cardId: 'c1',
        outputName: '杀',
      });

      const shadow = harness.state.cardMap['c1#界渐营'];
      expect(shadow).toBeDefined();
      // 保留源卡花色 ♣
      expect(shadow.suit).toBe('♣');
      expect(shadow.color).toBe('黑');
    } finally {
      restoreAutoCompare();
    }
  });
});
