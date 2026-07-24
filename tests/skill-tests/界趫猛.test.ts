// 界趫猛(界公孙瓒·被动技)测试:
//   当你使用【杀】对一名角色造成伤害后,你可以弃置其区域里的一张牌。
//   若此牌为坐骑牌,你获得之。
//
// 验证:
//   1. 杀造成伤害 + 发动 + 选目标手牌 → 弃置
//   2. 杀造成伤害 + 发动 + 选目标装备(非坐骑) → 弃置
//   3. 杀造成伤害 + 发动 + 选目标坐骑 → 获得(到手牌)
//   4. 杀造成伤害 + 不发动 → 无效果
//   5. 非杀伤害(直接造成伤害 atom)→ 不触发趫猛
//   6. 目标无牌(空手+空装+空判定)→ 不触发
//   7. 选目标判定区延时锦囊 → 弃置
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { runDamageFlow } from '../../src/engine/damage-flow';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeMount(
  id: string,
  name: string,
  subtype: '进攻马' | '防御马',
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
): Card {
  return { id, name, suit, color: suitColor(suit), rank: 'A', type: '装备牌', subtype };
}

function makeWeapon(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  range = 2,
): Card {
  return {
    id,
    name,
    suit,
    color: suitColor(suit),
    rank: 'A',
    type: '装备牌',
    subtype: '武器',
    range,
  };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  equipment?: Record<string, string>;
  pendingTricks?: PlayerState['pendingTricks'];
  character?: string;
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界公孙瓒',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: (opts.vars ?? {}) as Record<string, import('../../src/engine/types').Json>,
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    tags: [],
    judgeZone: [],
  };
}

describe('界趫猛', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 杀造成伤害 + 发动 + 选目标手牌 → 弃置
  // ─────────────────────────────────────────────────────────────
  it('用例1:杀P1(2 手牌)→ 发动 → 盲选 hand[0] → P1 该手牌被弃', async () => {
    const slash = makeCard('s1', '杀');
    const p1c1 = makeCard('p1c1', '闪');
    const p1c2 = makeCard('p1c2', '桃');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['杀', '界趫猛'],
          vars: { '距离/出杀范围': 1 },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1c1', 'p1c2'],
          skills: ['闪'],
        }),
      ],
      cardMap: { s1: slash, p1c1, p1c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass(); // 不出闪

    // 杀命中 →趫猛 confirm 询问
    P0.expectPending('请求回应');
    await P0.respond('界趫猛', { choice: true });

    // 选牌面板:盲选 hand[0]
    P0.expectPending('请求回应');
    await P0.respond('界趫猛', { zone: 'hand', handIndex: 0 });

    expect(harness.state.players[1].health).toBe(3); // 命中扣 1 血
    expect(harness.state.players[1].hand).not.toContain('p1c1');
    expect(harness.state.players[1].hand).toContain('p1c2'); // 第 2 张保留
    expect(harness.state.zones.discardPile).toContain('p1c1');
    expect(harness.state.players[0].hand).not.toContain('p1c1'); // 未获得
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 杀造成伤害 + 发动 + 选目标装备(非坐骑) → 弃置
  // ─────────────────────────────────────────────────────────────
  it('用例2:杀P1(持武器)→ 发动 → 选装备 → 武器被弃,P0 未获得', async () => {
    const slash = makeCard('s1', '杀');
    const weapon = makeWeapon('w1', '诸葛连弩', '♣');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['杀', '界趫猛'],
          vars: { '距离/出杀范围': 1 },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          equipment: { 武器: 'w1' },
          skills: ['闪'],
        }),
      ],
      cardMap: { s1: slash, w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    await P0.respond('界趫猛', { choice: true });

    // 选牌面板:选装备(武器)
    P0.expectPending('请求回应');
    await P0.respond('界趫猛', { zone: 'equipment', cardId: 'w1' });

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[0].hand).not.toContain('w1'); // 非坐骑→弃置,不获得
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 杀造成伤害 + 发动 + 选目标坐骑 → 获得(到手牌)
  // ─────────────────────────────────────────────────────────────
  it('用例3:杀P1(持进攻马)→ 发动 → 选坐骑 → P0 获得该坐骑到手的牌', async () => {
    const slash = makeCard('s1', '杀');
    const mount = makeMount('m1', '赤兔', '进攻马');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['杀', '界趫猛'],
          vars: { '距离/出杀范围': 1 },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          equipment: { 进攻马: 'm1' },
          skills: ['闪'],
        }),
      ],
      cardMap: { s1: slash, m1: mount },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    await P0.respond('界趫猛', { choice: true });

    // 选牌面板:选坐骑(进攻马)
    P0.expectPending('请求回应');
    await P0.respond('界趫猛', { zone: 'equipment', cardId: 'm1' });

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].equipment['进攻马']).toBeUndefined();
    expect(harness.state.zones.discardPile).not.toContain('m1'); // 坐骑→获得,不入弃
    expect(harness.state.players[0].hand).toContain('m1'); // P0 获得该坐骑
  });

  it('用例3b:杀P1(持防御马)→ 发动 → 选防御马 → P0 获得', async () => {
    const slash = makeCard('s1', '杀');
    const mount = makeMount('m2', '的卢', '防御马');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['杀', '界趫猛'],
          vars: { '距离/出杀范围': 1 },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          equipment: { 防御马: 'm2' },
          skills: ['闪'],
        }),
      ],
      cardMap: { s1: slash, m2: mount },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    await P0.respond('界趫猛', { choice: true });
    await P0.respond('界趫猛', { zone: 'equipment', cardId: 'm2' });

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].equipment['防御马']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('m2');
    expect(harness.state.zones.discardPile).not.toContain('m2');
  });

  // ─────────────────────────────────────────────────────────────
  // 4. 杀造成伤害 + 不发动 → 无效果
  // ─────────────────────────────────────────────────────────────
  it('用例4:杀P1 → 不发动趫猛 → 无弃牌,P1 装备保留', async () => {
    const slash = makeCard('s1', '杀');
    const mount = makeMount('m1', '赤兔', '进攻马');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['杀', '界趫猛'],
          vars: { '距离/出杀范围': 1 },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          equipment: { 进攻马: 'm1' },
          skills: ['闪'],
        }),
      ],
      cardMap: { s1: slash, m1: mount },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    await P0.respond('界趫猛', { choice: false }); // 不发动

    expect(harness.state.players[1].health).toBe(3); // 仍扣 1 血(趫猛不影响伤害)
    expect(harness.state.players[1].equipment['进攻马']).toBe('m1'); // 装备保留
    expect(harness.state.players[0].hand).not.toContain('m1');
  });

  // ─────────────────────────────────────────────────────────────
  // 5. 非杀伤害(直接造成伤害 atom)→ 不触发趫猛
  // ─────────────────────────────────────────────────────────────
  it('用例5:非杀伤害(无 cardId)→ 不触发趫猛', async () => {
    const { registerSkillsFromState } = await import(
      '../../src/engine/create-engine'
    );
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界趫猛'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1c1'],
          skills: ['闪'],
        }),
      ],
      cardMap: { p1c1: makeCard('p1c1', '闪') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 直接造成伤害(无 cardId,模拟非杀伤害)
    await runDamageFlow(state, 0, 1, 1);

    expect(state.players[1].health).toBe(3);
    expect(state.pendingSlots.size).toBe(0); // 无趫猛询问
    expect(state.players[1].hand).toContain('p1c1'); // 未被弃
  });

  it('用例5b:伤害 cardId 是万箭齐发(非杀)→ 不触发趫猛', async () => {
    const { registerSkillsFromState } = await import(
      '../../src/engine/create-engine'
    );
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界趫猛'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1c1'],
          skills: ['闪'],
        }),
      ],
      cardMap: {
        p1c1: makeCard('p1c1', '闪'),
        aoe: makeCard('aoe', '万箭齐发', '♥', 'A', '锦囊牌'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    await runDamageFlow(state, 0, 1, 1, 'aoe');

    expect(state.players[1].health).toBe(3);
    expect(state.pendingSlots.size).toBe(0); // 无趫猛询问
  });

  // ─────────────────────────────────────────────────────────────
  // 6. 目标无牌(空手+空装+空判定)→ 不触发趫猛
  // ─────────────────────────────────────────────────────────────
  it('用例6:杀P1(无牌)→ 不触发趫猛询问', async () => {
    const slash = makeCard('s1', '杀');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['杀', '界趫猛'],
          vars: { '距离/出杀范围': 1 },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['闪'],
        }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();

    // P1 无牌→趫猛不询问,无 pending
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 7. 选目标判定区延时锦囊 → 弃置
  // ─────────────────────────────────────────────────────────────
  it('用例7:杀P1(持乐不思蜀)→ 发动 → 选判定区 → 乐不思蜀被弃', async () => {
    const slash = makeCard('s1', '杀');
    const trickCard = makeCard('lb1', '乐不思蜀', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['杀', '界趫猛'],
          vars: { '距离/出杀范围': 1 },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          pendingTricks: [
            { name: '乐不思蜀', card: trickCard, source: 0 },
          ],
          skills: ['闪'],
        }),
      ],
      cardMap: { s1: slash, lb1: trickCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    await P0.respond('界趫猛', { choice: true });

    // 选牌面板:选判定区
    P0.expectPending('请求回应');
    await P0.respond('界趫猛', { zone: 'judge', cardId: 'lb1' });

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].pendingTricks).toEqual([]); // 判定区被清
    expect(harness.state.zones.discardPile).toContain('lb1');
    expect(harness.state.players[0].hand).not.toContain('lb1'); // 判定区牌→弃置,不获得
  });
});
