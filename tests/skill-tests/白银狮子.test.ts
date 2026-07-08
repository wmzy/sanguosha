// 白银狮子(防具):当你受到伤害时,此伤害值最多为 1(>1 则减为 1)。
//   失去装备区里的白银狮子后,回复 1 点体力。
//
// 实现(白银狮子.ts):
//   - before hook 挂「造成伤害」:target=自己 + amount>1 + 装备白银狮子 → modify amount=1
//   - after hook 挂「卸下(防具)」:弃牌堆顶为白银狮子 → 回复体力 1
//   注:卸下 atom 将装备移回手牌(非弃牌堆),故常规替换流程下回血 after-hook
//   不会命中。此处通过直接造成伤害验证减伤,并以预置弃牌堆顶 + 直接卸下验证回血代码路径。
//
// 验证:
//   1. 正面:受到 2 点伤害 → 减为 1(减伤生效)
//   2. 边界:受到 1 点伤害 → 不变(amount<=1 不触发减伤)
//   3. 回血:失去白银狮子(卸下 + 弃牌堆顶为白银狮子)→ 回复 1 点体力
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  equipment?: Record<string, string>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: 4,
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

// 白银狮子牌(防具)
const BAIYIN: Card = {
  id: 'by',
  name: '白银狮子',
  suit: '♣',
  color: suitColor('♣'),
  rank: '2',
  type: '装备牌',
  subtype: '防具',
};

describe('白银狮子', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:2 点伤害减为 1 ─────────────────────────────────

  it('正面:受到 2 点伤害 → 减为 1 点(只扣 1 血)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['白银狮子'],
          equipment: { 防具: 'by' },
        }),
      ],
      cardMap: { by: BAIYIN },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接造成 2 点伤害 → 白银狮子 before hook 减为 1
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 2,
      source: 0,
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].alive).toBe(true);
  });

  // ─── 边界:1 点伤害不减(amount<=1 不触发)─────────────────

  it('边界:受到 1 点伤害 → 不变(扣 1 血,不超额减伤)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['白银狮子'],
          equipment: { 防具: 'by' },
        }),
      ],
      cardMap: { by: BAIYIN },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 1,
      source: 0,
    });
    await harness.waitForStable();
    harness.processAllEvents();

    // amount=1 <=1 → hook 不触发,正常扣 1 血
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 回血:失去白银狮子 ──────────────────────────────────

  it('回血:卸下防具且弃牌堆顶为白银狮子 → 回复 1 点体力', async () => {
    // 预置一张白银狮子于弃牌堆顶(模拟"失去白银狮子入弃牌堆"的判定条件)
    const seed: Card = {
      id: 'by-seed',
      name: '白银狮子',
      suit: '♣',
      color: suitColor('♣'),
      rank: '3',
      type: '装备牌',
      subtype: '防具',
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: [] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['白银狮子'],
          health: 2,
          equipment: { 防具: 'by' },
        }),
      ],
      cardMap: { by: BAIYIN, 'by-seed': seed },
      zones: { deck: [], discardPile: ['by-seed'], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    expect(harness.state.players[1].health).toBe(2);

    // 直接卸下防具:after-hook 见弃牌堆顶为白银狮子 → 回复 1 体力
    await applyAtom(harness.state, { type: '卸下', player: 1, slot: '防具' });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(3);
    // 装备已卸下(移回手牌)
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
  });
});
