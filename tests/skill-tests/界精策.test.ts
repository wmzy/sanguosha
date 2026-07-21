// tests/skill-tests/界精策.test.ts
// 界精策(界郭淮·魏·被动技)测试(OL 界限突破 hero/658 逐字):
//   "你每于回合内使用一种花色的手牌,本回合的手牌上限便+1;
//    每个出牌阶段结束时,你可以摸X张牌
//    (X为你本回合使用过牌的类型数)。"
//
// 验证:
//   子句1(手牌上限加成):
//     1. 用 1 张牌(单花色)→ handLimit = health + 1
//     2. 用 2 张不同花色 → handLimit = health + 2
//     3. 用同花色重复 → 不再增加 bonus
//     4. 装备牌的花色也累计
//   子句2(出牌阶段结束摸X张):
//     5. 用过基本牌+锦囊牌 → X=2 → confirm → 摸2张
//     6. 用过基本牌+锦囊牌+装备牌 → X=3 → confirm → 摸3张
//     7. X=0(未用牌)→ 不询问
//     8. confirm=false → 不摸
//   集成:
//     9. bonus 实际影响弃牌阶段(health=2, 用1花色 → 弃牌上限=3)
//     10. 仅在自己回合累积(其他玩家回合不计入)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { handLimit } from '../../src/engine/hand-limit';
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

function makeEquip(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  subtype: '武器' | '防具' | '进攻马' | '防御马',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype, range: 2 };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '界郭淮',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界精策', '回合管理'],
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

describe('界精策', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 子句1:手牌上限加成 ───────────────────────────────────────

  // ─── 1. 单花色 → bonus=1 ────────────────────────────────────
  it('子句1:出杀(单花色)→ 本回合手牌上限 +1', async () => {
    // P0:HP=4,手牌:♠杀 → 用后 bonus=1, handLimit=5
    const sha = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界精策', '回合管理', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { s1: sha },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 初始 bonus 无
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBeUndefined();
    expect(handLimit(harness.state, 0)).toBe(4);

    // P0 对 P1 出杀
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass(); // P1 不闪

    // bonus = 1(♠ 一种花色)
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBe(1);
    expect(handLimit(harness.state, 0)).toBe(5);
  });

  // ─── 2. 两种不同花色 → bonus=2 ──────────────────────────────
  it('子句1:用两种不同花色 → 本回合手牌上限 +2', async () => {
    const sha = makeCard('s1', '杀', '♠', '7');
    const trick = makeCard('wz', '无中生有', '♥', '3', '锦囊牌');
    const d1 = makeCard('d1', '杀', '♣', '2'); // 无中生有摸上来的牌
    const d2 = makeCard('d2', '杀', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'wz'],
          skills: ['界精策', '回合管理', '杀', '无中生有'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { s1: sha, wz: trick, d1, d2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 出杀(♠)→ bonus=1
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBe(1);

    // 出无中生有(♥)→ bonus=2
    await P0.useCard('无中生有', 'wz');
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBe(2);
    expect(handLimit(harness.state, 0)).toBe(6);
  });

  // ─── 3. 同花色重复使用 → 不再增加 bonus ────────────────────
  // 用 杀(1次,杀上限)+ 多个装备(不同槽位,不替换)组合验证
  it('子句1:用同花色重复 → bonus 不再增加', async () => {
    const sha = makeCard('s1', '杀', '♠', '7');
    const w1 = makeEquip('w1', '青釭剑', '♦', '武器', 'A'); // ♦
    const w2 = makeEquip('w2', '八卦阵', '♦', '防具', '2'); // ♦ 同花色
    const w3 = makeEquip('w3', '的卢', '♥', '防御马', '3'); // ♥ 新花色
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'w1', 'w2', 'w3'],
          skills: ['界精策', '回合管理', '杀', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { s1: sha, w1, w2, w3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 杀(♠)→ bonus=1
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBe(1);

    // 装武器(♦)→ bonus=2
    await P0.useCard('装备通用', 'w1');
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBe(2);

    // 装防具(♦ 同花色)→ bonus 仍为 2
    await P0.useCard('装备通用', 'w2');
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBe(2);

    // 装防御马(♥ 新花色)→ bonus=3
    await P0.useCard('装备通用', 'w3');
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBe(3);
    expect(handLimit(harness.state, 0)).toBe(7); // 4 + 3
  });

  // ─── 4. 装备牌的花色也累计 ──────────────────────────────────
  it('子句1:装备牌(♦)→ bonus +1,类型集合含装备牌', async () => {
    const weapon = makeEquip('w1', '青釭剑', '♦', '武器', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['w1'],
          skills: ['界精策', '回合管理', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 装备武器
    await P0.useCard('装备通用', 'w1');

    // 装备已生效
    expect(harness.state.players[0].equipment['武器']).toBe('w1');
    // bonus=1(♦ 一种花色)
    expect(harness.state.turn.vars[handLimitBonusKey(0)]).toBe(1);
    expect(handLimit(harness.state, 0)).toBe(5);
    // 类型集合含装备牌
    expect(harness.state.turn.vars['界精策/usedTypes:0']).toEqual(['装备牌']);
  });

  // ─── 子句2:出牌阶段结束摸X张 ──────────────────────────────────

  // ─── 5. 基本牌+锦囊牌 → X=2 → 摸2张 ────────────────────────
  it('子句2:用基本牌+锦囊牌 → 出牌阶段结束 → 摸2张', async () => {
    const sha = makeCard('s1', '杀', '♠', '7');
    const wz = makeCard('wz', '无中生有', '♥', '3', '锦囊牌');
    const d1 = makeCard('d1', '杀', '♣', '2');
    const d2 = makeCard('d2', '杀', '♦', '4');
    const d3 = makeCard('d3', '桃', '♥', '5');
    const d4 = makeCard('d4', '桃', '♠', '6');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'wz'],
          skills: ['界精策', '回合管理', '杀', '无中生有'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { s1: sha, wz, d1, d2, d3, d4 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 出杀(基本牌)
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    // 出无中生有(锦囊牌)→ 无懈窗口 → P1 不打无懈 → 摸 d1,d2
    await P0.useCard('无中生有', 'wz');
    await P1.pass(); // 无懈可击窗口
    expect(harness.state.players[0].hand.length).toBe(2); // d1, d2

    // 结束出牌阶段 → 触发精策询问(X=2:基本牌+锦囊牌)
    await P0.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).toBe('界精策/confirm');

    // 确认摸牌
    const handBefore = harness.state.players[0].hand.length;
    await P0.respond('界精策', { choice: true });
    // 摸了 2 张
    expect(harness.state.players[0].hand.length).toBe(handBefore + 2);
  });

  // ─── 6. 基本牌+锦囊牌+装备牌 → X=3 → 摸3张 ────────────────
  it('子句2:用基本牌+锦囊牌+装备牌 → X=3 → 摸3张', async () => {
    const sha = makeCard('s1', '杀', '♠', '7');
    const wz = makeCard('wz', '无中生有', '♥', '3', '锦囊牌');
    const weapon = makeEquip('w1', '青釭剑', '♦', '武器', 'A');
    const d1 = makeCard('d1', '桃', '♣', '2');
    const d2 = makeCard('d2', '桃', '♦', '4');
    const d3 = makeCard('d3', '桃', '♥', '5');
    const d4 = makeCard('d4', '桃', '♠', '6');
    const d5 = makeCard('d5', '桃', '♣', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'wz', 'w1'],
          skills: ['界精策', '回合管理', '杀', '无中生有', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { s1: sha, wz, w1: weapon, d1, d2, d3, d4, d5 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3', 'd4', 'd5'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 出杀(基本牌)
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    // 出无中生有(锦囊牌)→ 无懈窗口 → P1 不打 → 摸 d1,d2
    await P0.useCard('无中生有', 'wz');
    await P1.pass(); // 无懈可击窗口
    // 装备武器(装备牌)
    await P0.useCard('装备通用', 'w1');

    // 结束出牌阶段 → 触发精策询问(X=3:基本牌+锦囊牌+装备牌)
    await P0.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).toBe('界精策/confirm');

    // 确认摸牌 → 摸3张
    const handBefore = harness.state.players[0].hand.length;
    await P0.respond('界精策', { choice: true });
    expect(harness.state.players[0].hand.length).toBe(handBefore + 3);
  });

  // ─── 7. 未使用任何牌 → X=0 → 不询问 ────────────────────────
  it('子句2:未使用任何牌 → X=0 → 不询问摸牌', async () => {
    const sha = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'], // 手里有牌但不出
          skills: ['界精策', '回合管理', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { s1: sha },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 直接结束出牌阶段 → 无精策询问(直接进入弃牌或下回合)
    await P0.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).not.toBe('界精策/confirm');
  });

  // ─── 8. confirm=false → 不摸牌 ─────────────────────────────
  it('子句2:选择不摸 → confirm=false → 不摸', async () => {
    const sha = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界精策', '回合管理', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { s1: sha },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 出杀 → 类型集合 = {基本牌}
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    // 结束出牌阶段 → 触发精策询问(X=1)
    await P0.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).toBe('界精策/confirm');

    // 选择不摸
    const handBefore = harness.state.players[0].hand.length;
    await P0.respond('界精策', { choice: false });
    // 手牌不变
    expect(harness.state.players[0].hand.length).toBe(handBefore);
  });

  // ─── 集成验证 ────────────────────────────────────────────────

  // ─── 9. bonus 实际影响弃牌阶段:health=2,用1花色 → 上限=3 ──
  it('集成:health=2 用1花色 → 弃牌上限=3,4 张手牌只弃 1 张', async () => {
    const sha = makeCard('s1', '杀', '♠', '7');
    const c2 = makeCard('c2', '桃', '♥', '2');
    const c3 = makeCard('c3', '桃', '♦', '3');
    const c4 = makeCard('c4', '桃', '♣', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'c2', 'c3', 'c4'],
          health: 2,
          maxHealth: 4,
          skills: ['界精策', '回合管理', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { s1: sha, c2, c3, c4 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 出杀(♠)→ bonus=1 → handLimit=2+1=3
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    expect(handLimit(harness.state, 0)).toBe(3);

    // 结束出牌阶段 → 精策询问(选择不摸,以单独验证弃牌阶段)
    await P0.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).toBe('界精策/confirm');
    await P0.respond('界精策', { choice: false });

    // 进入弃牌阶段:手牌3张(c2,c3,c4),上限=3 → 不需弃牌
    expect(currentRequestType(harness.state)).not.toBe('__弃牌');
    expect(harness.state.players[0].hand.length).toBe(3);
  });

  // ─── 10. 仅在自己回合累积(其他玩家回合不计入) ──────────────
  it('边界:其他玩家回合使用的牌不计入精策', async () => {
    // P1(郭淮) 在 P0 回合内对 P0 的杀打出 闪(♣)
    // 不应计入 P1 的精策(P1 不是当前回合玩家)
    const sha = makeCard('s1', '杀', '♠', '7');
    const shan = makeCard('shan1', '闪', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['杀', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['shan1'],
          skills: ['界精策', '闪'],
        }),
      ],
      cardMap: { s1: sha, shan1: shan },
      currentPlayerIndex: 0, // P0 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 出杀指定 P1
    await P0.useCardAndTarget('杀', 's1', [1]);
    // P1 出闪(P1 在 P0 回合内打出,不应计入 P1 的精策)
    await P1.useCard('闪', 'shan1');

    // P1 的精策 bonus 不应增加
    expect(harness.state.turn.vars[handLimitBonusKey(1)]).toBeUndefined();
    expect(harness.state.turn.vars['界精策/usedSuits:1']).toBeUndefined();
    expect(harness.state.turn.vars['界精策/usedTypes:1']).toBeUndefined();
  });
});
