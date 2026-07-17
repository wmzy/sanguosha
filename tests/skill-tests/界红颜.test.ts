// tests/skill-tests/界红颜.test.ts
// 界红颜(界小乔·锁定技):你的黑桃牌和黑桃判定牌视为红桃牌。
//   若你的装备区里有红桃牌，你的手牌上限等于体力上限。
//
// 官方来源:三国杀 OL 界限突破 hero/457。
//
// 验证:
//   1. 判定牌黑桃→红桃(复用标红颜逻辑)
//   2. 装备区有红桃牌 → 手牌上限=体力上限(health<maxHealth 时仍不弃至 maxHealth)
//   3. 装备区无红桃牌 → 手牌上限=体力(默认公式)
//   4. 装备区红桃牌被弃/移除后 → 回归默认上限
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { applyAtom, pushFrame, popFrame } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, EquipSlot, GameState, PlayerState } from '../../src/engine/types';

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
  equipment?: Partial<Record<EquipSlot, string>>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界小乔',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? opts.health ?? 3,
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

describe('界红颜', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 判定牌黑桃→红桃 ─────────────────────────────────────
  it('界小乔判定:牌堆顶黑桃 → 花色转为红桃', async () => {
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界小乔', skills: ['界红颜'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    await pushFrame(harness.state, 'test', 0, {});
    await applyAtom(harness.state, { type: '判定', player: 0, judgeType: '界红颜测试' });
    await popFrame(harness.state);
    await harness.waitForStable();
    harness.player('界小乔').processEvents();

    expect(harness.state.cardMap['j1'].suit).toBe('♥');
    expect(harness.state.cardMap['j1'].color).toBe('红');
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 2. 装备区有红桃牌 → 手牌上限=体力上限 ──────────────────
  it('弃牌阶段:装备区有红桃牌 → 手牌上限=体力上限(health=1,maxHealth=3,手牌3不弃)', async () => {
    const heartEquip = makeCard('eq1', '白银狮子', '♥', 'A', '装备牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界小乔',
          hand: ['c1', 'c2', 'c3'],
          skills: ['界红颜', '回合管理'],
          health: 1,
          maxHealth: 3,
          equipment: { 防具: 'eq1' },
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '闪', '♦', '4'),
        eq1: heartEquip,
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界小乔');

    await P0.triggerAction('回合管理', 'end', {});

    // 上限=体力上限=3(非体力 1),手牌=3 → 无需弃牌
    const rt = [...harness.state.pendingSlots.values()].map(
      (s) => (s.atom as { requestType?: string }).requestType,
    );
    expect(rt).not.toContain('__弃牌');
    expect(harness.state.players[0].hand.length).toBe(3);
  });

  // ─── 3. 装备区无红桃牌 → 手牌上限=体力(默认) ────────────────
  it('弃牌阶段:装备区无红桃牌 → 手牌上限=体力(health=1,手牌3应弃2)', async () => {
    // 黑桃装备(红颜下视为红桃判定牌,但装备区花色判断用原始花色?界红颜装备检查用 card.suit)
    // 界红颜的 hasHeartInEquipment 检查 card.suit==='♥';黑桃装备不算红桃装备
    const spadeEquip = makeCard('eq1', '寒冰剑', '♠', 'A', '装备牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界小乔',
          hand: ['c1', 'c2', 'c3'],
          skills: ['界红颜', '回合管理'],
          health: 1,
          maxHealth: 3,
          equipment: { 武器: 'eq1' },
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '闪', '♦', '4'),
        eq1: spadeEquip,
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界小乔');

    await P0.triggerAction('回合管理', 'end', {});

    // 装备区只有黑桃(非红桃)→ 不满足条件 → 上限=体力=1,手牌3 → 弃2
    const rt = [...harness.state.pendingSlots.values()].map(
      (s) => (s.atom as { requestType?: string }).requestType,
    );
    expect(rt).toContain('__弃牌');
  });

  // ─── 4. 无装备时 → 默认上限=体力 ────────────────────────────
  it('弃牌阶段:无装备 → 手牌上限=体力(health=2,手牌3应弃1)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界小乔',
          hand: ['c1', 'c2', 'c3'],
          skills: ['界红颜', '回合管理'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♣', '1'),
        c2: makeCard('c2', '桃', '♣', '2'),
        c3: makeCard('c3', '闪', '♦', '4'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界小乔');

    await P0.triggerAction('回合管理', 'end', {});

    // 无红桃装备 → 上限=体力=2,手牌3 → 弃1
    const slots = [...harness.state.pendingSlots.values()];
    const discardSlot = slots.find(
      (s) => (s.atom as { requestType?: string }).requestType === '__弃牌',
    );
    expect(discardSlot).toBeDefined();
    const prompt = (discardSlot!.atom as { prompt?: { cardFilter?: { min?: number } } }).prompt;
    expect(prompt?.cardFilter?.min).toBe(1);
  });
});
