// tests/skill-tests/马匹技能.test.ts
// 马匹技能(进攻马/防御马)测试:验证装备后距离修正 vars 正确设置/清除。
// 关键验证点:技能实例化(添加技能 after hook)与 vars 设置的时序。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function makeEquip(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', subtype: '进攻马' | '防御马'): Card {
  return { id, name, suit, color: suitColor(suit), rank: 'A', type: '装备牌', subtype };
}

function makePlayer(opts: { index: number; name: string; hand?: string[]; skills?: string[] }) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['装备通用'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('马匹技能', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('装备进攻马(赤兔)→ vars[距离/进攻修正] = 1', async () => {
    const horse = makeEquip('h1', '赤兔', '♥', '进攻马');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { h1: horse },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('装备通用', 'h1');

    expect(harness.state.players[0].equipment['进攻马']).toBe('h1');
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(1);
    // view 级断言
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].equipment['进攻马']).toBe('h1');
      expect(v.players[0].handCount).toBe(0);
    });
  });

  it('装备防御马(的卢)→ vars[距离/防御修正] = 1', async () => {
    const horse = makeEquip('h2', '的卢', '♣', '防御马');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h2'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { h2: horse },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('装备通用', 'h2');

    expect(harness.state.players[0].equipment['防御马']).toBe('h2');
    expect(harness.state.players[0].vars['距离/防御修正']).toBe(1);
  });

  it('马匹技能加入 player.skills(与其他装备技能一致)', async () => {
    const horse = makeEquip('h1', '赤兔', '♥', '进攻马');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { h1: horse },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('装备通用', 'h1');

    expect(harness.state.players[0].skills).toContain('赤兔');
  });

  it('换装进攻马:旧马技能移除,新马技能加入,vars 仍为 1(不叠加)', async () => {
    const horse1 = makeEquip('h1', '赤兔', '♥', '进攻马');
    const horse2 = makeEquip('h2', '紫骍', '♦', '进攻马');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1', 'h2'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { h1: horse1, h2: horse2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('装备通用', 'h1');
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(1);

    // 换装:h2 替换 h1
    await P1.useCard('装备通用', 'h2');
    expect(harness.state.players[0].equipment['进攻马']).toBe('h2');
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(1);
    expect(harness.state.players[0].skills).not.toContain('赤兔');
    expect(harness.state.players[0].skills).toContain('紫骍');
  });
});
