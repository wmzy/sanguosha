// tests/skill-tests/克己.test.ts
// 克己(吕蒙·吴国)技能测试:
//   发动条件:本回合未使用或打出过【杀】
//   效果:跳过弃牌阶段(不弃牌)
//
// 验证:
//   1. 正面:未出杀 → 发动克己 → 跳过弃牌阶段,手牌保留
//   2. 负面:本回合出过杀 → 不满足条件,进入正常弃牌阶段
//   3. 边界:未出杀但选择不发动 → 进入正常弃牌阶段
//   4. 边界:超时不回应(defaultChoice=false)→ 进入正常弃牌阶段
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';
import { resetForTest } from '../../src/engine/create-engine';

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
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '吕蒙',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['克己', '回合管理'],
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

describe('克己', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    resetForTest();
    harness = new SkillTestHarness();
  });

  // ─── 正面:未出杀 → 发动克己 → 跳过弃牌阶段 ─────────────────

  it('未出杀 → 发动克己确认 → 跳过弃牌阶段,手牌全保留', async () => {
    // P0(吕蒙):HP=2,手牌 5 张(均非杀)→ 正常应弃 3 张
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2', 'c3', 'c4', 'c5'],
          health: 2,
          maxHealth: 2,
          skills: ['克己', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '过河拆桥', '♠', '3', '锦囊牌'),
        c4: makeCard('c4', '闪', '♦', '4'),
        c5: makeCard('c5', '桃', '♦', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    expect(harness.state.players[0].hand.length).toBe(5);

    // 结束出牌阶段 → 进入弃牌阶段前触发克己询问
    await P1.triggerAction('回合管理', 'end', {});

    // 应出现克己确认 pending(而非 __弃牌)
    expect(currentRequestType(harness.state)).toBe('克己/confirm');

    // 确认发动克己
    await P1.respond('克己', { choice: true });

    // 弃牌阶段被跳过:无 __弃牌 pending;手牌全保留;回合推进到下家
    expect(harness.state.players[0].hand.length).toBe(5);
    expect(currentRequestType(harness.state)).not.toBe('__弃牌');
  });

  // ─── 负面:本回合出过杀 → 不满足条件 ───────────────────────

  it('本回合出过杀 → 克己不触发,进入正常弃牌阶段', async () => {
    // P0(吕蒙):HP=2,手牌 5 张(含 1 张杀)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2', 'c3', 'c4', 'c5'],
          health: 2,
          maxHealth: 2,
          skills: ['克己', '回合管理', '杀'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '1'),
        c2: makeCard('c2', '闪', '♥', '2'),
        c3: makeCard('c3', '桃', '♥', '3'),
        c4: makeCard('c4', '闪', '♦', '4'),
        c5: makeCard('c5', '桃', '♦', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P0 对 P2 出杀(P2 在攻击范围内)
    await P1.useCardAndTarget('杀', 'c1', [1]);
    // P2 不出闪 → 受 1 点伤害
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    // 杀已消耗,手牌 4 张
    expect(harness.state.players[0].hand.length).toBe(4);

    // 结束出牌阶段 → 进入弃牌阶段
    await P1.triggerAction('回合管理', 'end', {});

    // 克己不应触发(本回合出过杀):应直接进入 __弃牌,而非 克己/confirm
    expect(currentRequestType(harness.state)).toBe('__弃牌');
    expect(currentRequestType(harness.state)).not.toBe('克己/confirm');

    // 弃 2 张(4 - HP2 = 2)
    await P1.respond('系统规则', { cardIds: ['c2', 'c3'] });
    expect(harness.state.players[0].hand.length).toBe(2);
  });

  // ─── 边界:未出杀但选择不发动 ──────────────────────────────

  it('未出杀但选择不发动克己 → 进入正常弃牌阶段', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2', 'c3', 'c4', 'c5'],
          health: 2,
          maxHealth: 2,
          skills: ['克己', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '过河拆桥', '♠', '3', '锦囊牌'),
        c4: makeCard('c4', '闪', '♦', '4'),
        c5: makeCard('c5', '桃', '♦', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).toBe('克己/confirm');

    // 选择不发动(choice=false)
    await P1.respond('克己', { choice: false });

    // 进入正常弃牌阶段
    expect(currentRequestType(harness.state)).toBe('__弃牌');

    // 弃 3 张(5 - HP2 = 3)
    await P1.respond('系统规则', { cardIds: ['c1', 'c2', 'c3'] });
    expect(harness.state.players[0].hand.length).toBe(2);
  });

  // ─── 边界:超时不回应 → 等同不发动 ─────────────────────────

  it('未出杀但超时不回应 → 进入正常弃牌阶段', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2', 'c3', 'c4', 'c5'],
          health: 2,
          maxHealth: 2,
          skills: ['克己', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '过河拆桥', '♠', '3', '锦囊牌'),
        c4: makeCard('c4', '闪', '♦', '4'),
        c5: makeCard('c5', '桃', '♦', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).toBe('克己/confirm');

    // 超时(pass = fireTimeout)→ defaultChoice=false → 不发动
    await P1.pass();

    // 进入正常弃牌阶段
    expect(currentRequestType(harness.state)).toBe('__弃牌');
  });
});
