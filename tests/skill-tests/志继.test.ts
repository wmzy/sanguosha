// 志继(姜维·觉醒技)行为测试:
//   1. 无手牌回合开始 → 选摸两张牌:摸2牌 + 减1上限 + 永久获得观星
//   2. 无手牌回合开始 → 选回复1点体力:回复1 + 减1上限 + 永久获得观星
//   3. 有手牌时不触发
//   4. 觉醒后再次回合开始不再触发(整局一次)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  return { id, name, suit, color, rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    health: opts.health ?? opts.maxHealth ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('志继', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('无手牌回合开始:选择摸两张牌 → 摸2牌 + 减1上限 + 获得观星', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '姜维',
            character: '姜维',
            hand: [],
            skills: ['志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const JW = harness.player('姜维');

    // 触发回合开始(志继 after-hook 询问二选一)
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    JW.expectPending('请求回应');

    // 选择摸两张牌(choice=true → draw)
    await JW.respond('志继', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(2); // 摸了2张
    expect(harness.state.players[0].maxHealth).toBe(3); // 减1上限(4→3)
    expect(harness.state.players[0].health).toBe(2); // 体力不变
    expect(harness.state.players[0].skills).toContain('观星'); // 永久获得观星
    expect(harness.state.players[0].vars['志继/awakened']).toBe(true); // 觉醒标记
  });

  it('无手牌回合开始:选择回复1点体力 → 回复1 + 减1上限 + 获得观星', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '姜维',
            character: '姜维',
            hand: [],
            skills: ['志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const JW = harness.player('姜维');

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    JW.expectPending('请求回应');

    // 选择回复1点体力(choice=false → heal)
    await JW.respond('志继', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3); // 2→3 回复1点
    expect(harness.state.players[0].hand.length).toBe(0); // 不摸牌
    expect(harness.state.players[0].maxHealth).toBe(3); // 减1上限(4→3)
    expect(harness.state.players[0].skills).toContain('观星');
    expect(harness.state.players[0].vars['志继/awakened']).toBe(true);
  });

  it('有手牌时回合开始不触发志继', async () => {
    const c = mkCard('h1', '闪', '♥', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '姜维',
            character: '姜维',
            hand: ['h1'],
            skills: ['志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: { h1: c },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 回合开始:有手牌,志继不触发,无 pending
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].vars['志继/awakened']).toBeFalsy(); // 未觉醒
    expect(harness.state.players[0].maxHealth).toBe(4); // 上限不变
    expect(harness.state.players[0].skills).not.toContain('观星');
  });

  it('觉醒后再次回合开始不再触发(整局一次)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '姜维',
            character: '姜维',
            hand: [],
            skills: ['志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const JW = harness.player('姜维');

    // 第一次回合开始:触发觉醒,选摸牌
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    await JW.respond('志继', { choice: true });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['志继/awakened']).toBe(true);
    const maxAfterAwaken = harness.state.players[0].maxHealth; // 3

    // 清空手牌模拟下一回合开始前的状态
    harness.state.players[0].hand = [];

    // 第二次回合开始:已觉醒,不再触发
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0); // 无询问
    expect(harness.state.players[0].maxHealth).toBe(maxAfterAwaken); // 上限不再减
    expect(harness.state.players[0].hand.length).toBe(0); // 没有再摸牌
  });
});
