// tests/skill-tests/界集智.test.ts
// 界集智(界黄月英·被动技):
//   OL 官方(hero/442):"当你使用非转化锦囊牌时,你可以摸一张牌,
//   若此牌是基本牌,你可以弃置此牌令你本回合手牌上限+1。"
//
// 与标集智差异:
//   - 标版仅"摸一张牌";界版新增"若此牌是基本牌,可弃之换本回合手牌上限+1"
//   - 界版显式限定「非转化」(转化锦囊不触发)
//
// 验证:
//   1. 正面:用非延时锦囊 → confirm 摸牌 → 摸 1 张
//   2. 正面:摸到基本牌 → confirm 弃置 → 弃之 + 本回合手牌上限+1
//   3. 边界:摸到基本牌 → 不弃置 → 保留在手牌
//   4. 边界:摸到非基本牌 → 不询问弃置,直接保留
//   5. 负面:confirm=false → 不摸牌
//   6. 负面:使用基本牌(杀)不触发
//   7. 关键差异:转化锦囊(乱击→万箭齐发)不触发界集智
//   8. 手牌上限 bonus 实际作用于弃牌阶段(集成 hand-limit.ts)
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
    character: '界黄月英',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界集智', '无中生有'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 取当前唯一 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return null;
  return (slots[0].atom as unknown as { requestType?: string }).requestType ?? null;
}

/** 手牌上限 bonus 的 turn.vars 键(与 hand-limit.ts 默认公式一致) */
function handLimitBonusKey(player: number): string {
  return `手牌上限/bonus:${player}`;
}

describe('界集智', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:用非延时锦囊 → confirm 摸牌 → 摸 1 张(基本牌)───
  it('用无中生有 → 集智 confirm 摸牌 → 摸到牌堆顶基本牌(杀)', async () => {
    const wz = makeCard('wz1', '无中生有', '♥', '7', '锦囊牌');
    // 牌堆:顶 = d3(杀,基本牌),下面两张 d2/d1(给无中生有摸)
    const d1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const d2 = makeCard('d2', '过河拆桥', '♠', '6', '锦囊牌');
    const d3 = makeCard('d3', '杀', '♣', '8', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wz1'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { wz1: wz, d1, d2, d3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 使用无中生有 → 集智 afterHook → 集智 confirm 窗口
    await P1.useCard('无中生有', 'wz1');
    expect(currentRequestType(harness.state)).toBe('界集智/confirm');

    // 确认摸牌
    await P1.respond('界集智', { choice: true });

    // 摸到 d3(基本牌)→ 询问是否弃置换上限
    expect(currentRequestType(harness.state)).toBe('界集智/discard');
    // 已摸到 d3,在手牌中
    expect(harness.state.players[0].hand).toContain('d3');
  });

  // ─── 2. 正面:摸到基本牌 → 弃置 → 弃之 + 本回合手牌上限+1 ─────
  it('摸到基本牌 → 集智 confirm 弃置 → 弃之 + turn.vars 手牌上限+1', async () => {
    const wz = makeCard('wz1', '无中生有', '♥', '7', '锦囊牌');
    const d1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const d2 = makeCard('d2', '过河拆桥', '♠', '6', '锦囊牌');
    const d3 = makeCard('d3', '杀', '♣', '8', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wz1'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { wz1: wz, d1, d2, d3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('无中生有', 'wz1');
    await P1.respond('界集智', { choice: true }); // 摸牌

    // 弃置 d3 换上限
    await P1.respond('界集智', { choice: true });

    // d3 进弃牌堆,不在手牌
    expect(harness.state.players[0].hand).not.toContain('d3');
    expect(harness.state.zones.discardPile).toContain('d3');
    // 手牌上限 bonus +1
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBe(1);
  });

  // ─── 3. 边界:摸到基本牌 → 不弃置 → 保留 ───────────────────
  it('摸到基本牌 → 集智 confirm 不弃置 → 保留在手牌,无 bonus', async () => {
    const wz = makeCard('wz1', '无中生有', '♥', '7', '锦囊牌');
    const d1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const d2 = makeCard('d2', '过河拆桥', '♠', '6', '锦囊牌');
    const d3 = makeCard('d3', '杀', '♣', '8', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wz1'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { wz1: wz, d1, d2, d3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('无中生有', 'wz1');
    await P1.respond('界集智', { choice: true }); // 摸牌
    // 不弃置
    await P1.respond('界集智', { choice: false });

    // d3 仍保留在手牌
    expect(harness.state.players[0].hand).toContain('d3');
    expect(harness.state.zones.discardPile).not.toContain('d3');
    // 无 bonus
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBeUndefined();
  });

  // ─── 4. 边界:摸到非基本牌 → 不询问弃置 ───────────────────
  it('摸到非基本牌(锦囊)→ 不询问弃置,直接保留', async () => {
    const wz = makeCard('wz1', '无中生有', '♥', '7', '锦囊牌');
    // 牌堆顶 d3 = 过河拆桥(锦囊,非基本牌)
    const d1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const d2 = makeCard('d2', '杀', '♣', '8', '基本牌');
    const d3 = makeCard('d3', '过河拆桥', '♠', '6', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wz1'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { wz1: wz, d1, d2, d3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('无中生有', 'wz1');
    await P1.respond('界集智', { choice: true }); // 摸牌

    // 摸到 d3(非基本牌)→ 无界集智/discard 窗口
    expect(currentRequestType(harness.state)).not.toBe('界集智/discard');
    // d3 保留在手牌
    expect(harness.state.players[0].hand).toContain('d3');
    // 无 bonus
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBeUndefined();
  });

  // ─── 5. 负面:confirm=false → 不摸牌 ────────────────────────
  it('集智 confirm=false → 不摸牌,仅无中生有摸 2 张', async () => {
    const wz = makeCard('wz1', '无中生有', '♥', '7', '锦囊牌');
    const d1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const d2 = makeCard('d2', '闪', '♥', '6', '基本牌');
    const d3 = makeCard('d3', '杀', '♣', '8', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wz1'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { wz1: wz, d1, d2, d3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('无中生有', 'wz1');
    await P1.respond('界集智', { choice: false }); // 不摸
    await P1.pass(); // 无懈窗口

    // 仅无中生有摸 2 张(从牌堆顶摸走 d3、d2,剩 d1)
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.deck).toEqual(['d1']);
  });

  // ─── 6. 负面:使用基本牌(杀)不触发 ────────────────────────
  it('使用基本牌(杀)不触发界集智', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'], skills: ['界集智', '杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's1', [1]);
    // 杀的目标被询问闪,而非界集智 confirm(基本牌不触发)
    P2.expectPending('询问闪');
    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 7. 关键差异:转化锦囊(乱击→万箭齐发)不触发 ─────────
  it('乱击转化出的万箭齐发不触发界集智(非转化过滤)', async () => {
    // P1 同时拥有 界集智 + 乱击 + 万箭齐发(use action 由万箭齐发技能注册)
    // 手牌:2 张同花色(♥)基本牌用于乱击转化
    const c1 = makeCard('c1', '杀', '♥', '5', '基本牌');
    const c2 = makeCard('c2', '杀', '♥', '6', '基本牌');
    // 牌堆:如果集智误触发会摸 d1
    const d1 = makeCard('d1', '杀', '♠', '7', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2'],
          skills: ['界集智', '乱击', '万箭齐发'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { c1, c2, d1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 乱击转化:c1+c2 → 影子"万箭齐发"(id=`c1#c2#乱击`),preceding + 万箭齐发.use
    await P1.transformThenUse(
      '乱击',
      { cardIds: ['c1', 'c2'] },
      '万箭齐发',
      { cardId: 'c1#c2#乱击' },
    );

    // 关键:万箭齐发是转化锦囊 → 界集智 afterHook 不触发 → 无界集智/confirm 窗口
    // 此时应进入无懈可击窗口或目标受到伤害流程
    expect(currentRequestType(harness.state)).not.toBe('界集智/confirm');
    // d1 未被摸(集智没触发)
    expect(harness.state.zones.deck).toEqual(['d1']);
  });

  // ─── 8. 集成:手牌上限 bonus 实际作用于弃牌阶段 ────────────
  it('弃置换上限后 → 弃牌阶段手牌上限+1(集成 hand-limit)', async () => {
    // P0 界黄月英 HP=2(手牌上限默认 2),手牌 wz1
    // 用无中生有 → 集智摸 d3(杀,基本牌)→ 弃之换上限+1
    // 之后无中生有还会摸 2 张(d2, d1)
    // 最终手牌:d2 + d1 = 2 张;手牌上限 = HP(2) + bonus(1) = 3 → 无需弃牌
    const wz = makeCard('wz1', '无中生有', '♥', '7', '锦囊牌');
    const d1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const d2 = makeCard('d2', '闪', '♥', '6', '基本牌');
    const d3 = makeCard('d3', '杀', '♣', '8', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['wz1'],
          health: 2,
          maxHealth: 3,
          skills: ['界集智', '无中生有', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: { wz1: wz, d1, d2, d3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 用无中生有 → 集智摸 → 弃 d3 换上限+1 → 无中生有再摸 d2, d1
    await P1.useCard('无中生有', 'wz1');
    await P1.respond('界集智', { choice: true }); // 摸牌(d3 基本牌)
    await P1.respond('界集智', { choice: true }); // 弃 d3 换上限+1
    await P1.pass(); // 无中生有的无懈可击窗口(无人打出)

    // 手牌:d2 + d1 = 2 张;bonus = 1;HP = 2;手牌上限 = 2+1 = 3 → 2 ≤ 3 无需弃
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBe(1);

    // 结束出牌阶段进入弃牌阶段:手牌(2) ≤ 上限(3) → 不弹弃牌 pending
    await P1.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).not.toBe('__弃牌');
  });
});
