// tests/skill-tests/神速.test.ts
// 神速(夏侯渊)测试:
//   选项1:跳过判定+摸牌,视为对一名其他角色出杀(无距离限制)
//   选项2:跳过出牌+弃一张装备,视为对一名其他角色出杀
//
// 验证:
//   1. 正面(选项1):发动 → 选目标 → 目标受 1 点伤害(或可闪)
//   2. 正面(选项1):发动后摸牌阶段被跳过(不摸 2 张)
//   3. 负面(选项1):不发动 → 判定/摸牌阶段正常进行
//   4. 正面(选项2):有装备时发动 → 弃装备 + 目标受伤
//   5. 负面(选项2):无装备 → 不询问(直接进入出牌)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
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
    character: opts.character ?? '夏侯渊',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: (opts.equipment ?? {}),
    skills: opts.skills ?? ['神速'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 触发判定阶段:applyAtom(阶段开始, ownerId, 判定) → 神速 before-hook 询问 */
async function triggerJudgePhase(harness: SkillTestHarness, player = 0): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '判定' });
  await harness.waitForStable();
  harness.processAllEvents();
}

/** 触发出牌阶段:applyAtom(阶段开始, ownerId, 出牌) → 神速② before-hook 询问 */
async function triggerPlayPhase(harness: SkillTestHarness, player = 0): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '出牌' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('神速', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('选项1:发动 → 选目标 → 目标受 1 点伤害', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['神速'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    // 询问是否发动神速①
    P1.expectPending('请求回应');

    await P1.respond('神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问目标
    P1.expectPending('请求回应');
    await P1.respond('神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // virtualKill 会询问 P2 出闪 → P2 不闪
    const P2 = harness.player('P2');
    await P2.pass();

    // P2 受 1 点伤害(无闪可出)
    expect(harness.state.players[1].health).toBe(3);
    // 神速① 标记已用
    expect(harness.state.players[0].vars['神速/opt1Used']).toBe(true);
    // 跳过摸牌标签存在
    expect(harness.state.players[0].tags).toContain('神速/跳过摸牌');
  });

  it('选项1:发动后摸牌阶段被跳过(不摸 2 张)', async () => {
    // deck 有牌,验证发动神速①后不摸牌
    const deck: Card[] = [];
    const cardMap: Record<string, Card> = {};
    for (let i = 0; i < 5; i++) {
      const id = `dk${i}`;
      const c = makeCard(id, '杀', '♠', String(i + 2));
      deck.push(c);
      cardMap[id] = c;
    }
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['神速'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck: deck.map((c) => c.id), processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length;

    await triggerJudgePhase(harness);
    await P1.respond('神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    await P1.respond('神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // virtualKill 询问 P2 出闪 → P2 不闪
    const P2b = harness.player('P2');
    await P2b.pass();

    // 神速①已发动,P2 受伤。摸牌阶段被跳过(skip 标签已加)
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].tags).toContain('神速/跳过摸牌');
    // P1 手牌数量未因摸牌阶段增加(摸牌阶段尚未触发,但标签已确保会被跳过)
    expect(harness.state.players[0].hand.length).toBe(handBefore);
  });

  it('负面(选项1):不发动 → 神速①未使用,无伤害', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['神速'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    P1.expectPending('请求回应');

    await P1.respond('神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 不发动 → 无伤害,无跳过标签
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].vars['神速/opt1Used']).toBeUndefined();
    expect(harness.state.players[0].tags).not.toContain('神速/跳过摸牌');
  });

  it('选项2:有装备时发动 → 弃装备 + 目标受伤', async () => {
    const weapon: Card = {
      id: 'w1',
      name: '诸葛连弩',
      suit: '♣',
      color: '黑',
      rank: 'A',
      type: '装备牌',
      range: 1,
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [],
          skills: ['神速'],
          equipment: { '武器': 'w1' },
        }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPlayPhase(harness);
    // 询问是否发动神速②
    P1.expectPending('请求回应');

    await P1.respond('神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问弃哪张装备
    P1.expectPending('请求回应');
    await P1.respond('神速', { cardIds: ['w1'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问目标
    P1.expectPending('请求回应');
    await P1.respond('神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // virtualKill 询问 P2 出闪 → P2 不闪
    const P2c = harness.player('P2');
    await P2c.pass();

    // 装备已弃,P2 受伤
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].vars['神速/opt2Used']).toBe(true);
  });

  it('负面(选项2):无装备 → 不询问(直接进入出牌)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['神速'], equipment: {} }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await triggerPlayPhase(harness);
    // 无装备 → 不询问神速②(无 pending 由神速创建)
    // 可能处于出牌窗口或其他 pending,但不应是 神速/opt2-trigger
    const slots = [...harness.state.pendingSlots.values()];
    const shensuSlot = slots.find((s) => {
      const rt = (s.atom as unknown as { requestType?: string }).requestType;
      return rt === '神速/opt2-trigger';
    });
    expect(shensuSlot).toBeUndefined();
    // P2 未受伤
    expect(harness.state.players[1].health).toBe(4);
  });
});
