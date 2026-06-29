// 借刀杀人完整流程:出杀分支 + 不出杀分支
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function build3p(): GameState {
  const jdsr: Card = {
    id: 'jdsr',
    name: '借刀杀人',
    suit: '♠',
    color: '黑',
    rank: 'Q',
    type: '锦囊牌',
  };
  const wp1: Card = {
    id: 'wp1',
    name: '诸葛连弩',
    suit: '♠',
    color: '黑',
    rank: 'A',
    type: '装备牌',
  };
  const s2: Card = { id: 's2', name: '杀', suit: '♣', color: '黑', rank: '5', type: '基本牌' };
  return createGameState({
    players: [
      {
        index: 0,
        name: 'P0',
        character: 'X',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: ['jdsr'],
        equipment: {},
        skills: ['借刀杀人'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
      {
        index: 1,
        name: 'P1',
        character: 'Y',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: ['s2'],
        equipment: { 武器: 'wp1' },
        skills: ['杀', '闪'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
      {
        index: 2,
        name: 'P2',
        character: 'Z',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: ['闪'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
    ],
    cardMap: { jdsr, wp1, s2 },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}
const tick = () => new Promise((r) => setTimeout(r, 50));

describe('借刀杀人完整流程', () => {
  let h: SkillTestHarness;
  beforeEach(() => {
    h = new SkillTestHarness();
  });

  it('P1出杀→P2被询问闪', async () => {
    await h.setup(build3p());
    const P0 = h.player('P0');
    const P1 = h.player('P1');
    const _P2 = h.player('P2');
    await P0.triggerAction('借刀杀人', 'use', { cardId: 'jdsr', target: 1, killTarget: 2 });
    if (h.state.pendingSlots.size > 0) await P0.pass(); // 无懈
    if (h.state.pendingSlots.size > 0) {
      await P1.respond('杀', { cardId: 's2' });
      await tick();
    }
    expect(h.state.pendingSlots.size).toBeGreaterThan(0);
    expect(([...h.state.pendingSlots.values()][0].atom as { type: string }).type).toBe('询问闪');
  });

  it('P1不出杀→P0获得P1武器', async () => {
    await h.setup(build3p());
    const P0 = h.player('P0');
    const P1 = h.player('P1');
    await P0.triggerAction('借刀杀人', 'use', { cardId: 'jdsr', target: 1, killTarget: 2 });
    if (h.state.pendingSlots.size > 0) await P0.pass(); // 无懈
    // forceKill 询问 → P1 不出杀
    if (h.state.pendingSlots.size > 0) {
      await P1.pass();
      await tick();
    }
    // P0 获得武器(进手牌,不是装备区)
    expect(h.state.players[0].hand).toContain('wp1');
    expect(h.state.players[1].equipment['武器']).toBeUndefined();
  });

  it('P1出杀→P2出闪→不扣血', async () => {
    const d1: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
    const state = build3p();
    state.players[2].hand = ['d1'];
    state.cardMap['d1'] = d1;
    await h.setup(state);
    const P0 = h.player('P0');
    const P1 = h.player('P1');
    const P2 = h.player('P2');
    await P0.triggerAction('借刀杀人', 'use', { cardId: 'jdsr', target: 1, killTarget: 2 });
    if (h.state.pendingSlots.size > 0) await P0.pass();
    if (h.state.pendingSlots.size > 0) {
      await P1.respond('杀', { cardId: 's2' });
      await tick();
    }
    // P2 被询问闪 → 出闪
    if (h.state.pendingSlots.size > 0) {
      await P2.respond('闪', { cardId: 'd1' });
      await tick();
    }
    expect(h.state.players[2].health).toBe(4);
  });

  it('P1出杀→P2不出闪→扣血', async () => {
    await h.setup(build3p());
    const P0 = h.player('P0');
    const P1 = h.player('P1');
    const P2 = h.player('P2');
    await P0.triggerAction('借刀杀人', 'use', { cardId: 'jdsr', target: 1, killTarget: 2 });
    if (h.state.pendingSlots.size > 0) await P0.pass();
    if (h.state.pendingSlots.size > 0) {
      await P1.respond('杀', { cardId: 's2' });
      await tick();
    }
    // P2 不出闪
    if (h.state.pendingSlots.size > 0) {
      await P2.pass();
      await tick();
    }
    expect(h.state.players[2].health).toBe(3);
  });
});
