// 界英姿(界周瑜·吴·锁定技)测试
//   锁定技:摸牌阶段，你多摸一张牌。你的手牌上限为你的体力上限。
//
// 官方来源:三国杀 OL 界限突破 hero/308。
//
// 验证:
//   1. 锁定技:摸牌阶段强制多摸 1 张(无 confirm 询问)→ 摸 3 张,无 英姿/confirm pending
//   2. 手牌上限=体力上限:health=3,maxHealth=3,手牌 3 → 弃牌阶段不弃
//   3. 体力<上限时上限仍=体力上限:health=1,maxHealth=3,手牌 3 → 不弃(按体力应弃 2)
//   4. 手牌>体力上限才弃:health=1,maxHealth=3,手牌 4 → 只弃 1
//   5. 集成:开局摸 3 → 结束回合 → 弃牌阶段按体力上限(3)结算
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
    character: '界周瑜',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
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

/** 当前唯一 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return null;
  return (slots[0].atom as unknown as { requestType?: string }).requestType ?? null;
}

/** 是否存在 requestType==='英姿/confirm' 的 pending(锁定技应无此 pending) */
function hasYingziConfirm(state: GameState): boolean {
  for (const slot of state.pendingSlots.values()) {
    const rt = (slot.atom as unknown as { requestType?: string }).requestType;
    if (rt === '英姿/confirm') return true;
  }
  return false;
}

/** __弃牌 pending 要求弃的牌数(cardFilter.min),无 __弃牌 返回 null */
function discardExcess(state: GameState): number | null {
  for (const slot of state.pendingSlots.values()) {
    const atom = slot.atom as {
      requestType?: string;
      prompt?: { cardFilter?: { min?: number } };
    };
    if (atom.requestType === '__弃牌') {
      return atom.prompt?.cardFilter?.min ?? null;
    }
  }
  return null;
}

describe('界英姿', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 锁定技:摸牌阶段强制多摸 1 张(无 confirm 询问)─────────
  it('锁定技:摸牌阶段自动摸 3 张,不询问玩家', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const d3 = makeCard('d3', '桃', '♦', '4');
    const d4 = makeCard('d4', '酒', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界英姿', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { d1, d2, d3, d4 },
      zones: { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('回合管理', 'start');

    // 锁定技:无条件多摸一张(本应摸 2,实际摸 3),且不产生 英姿/confirm 询问
    expect(harness.state.players[0].hand.length).toBe(3);
    expect(harness.state.zones.deck.length).toBe(1);
    expect(hasYingziConfirm(harness.state)).toBe(false);
    // 锁定技不写 usedThisTurn / 手牌上限加成(上限由 provider 常驻提供)
    expect(harness.state.players[0].vars['英姿/usedThisTurn']).toBeUndefined();
    expect(harness.state.turn.vars['手牌上限/bonus:0']).toBeUndefined();
  });

  // ─── 2. 手牌上限=体力上限:health=3,maxHealth=3,手牌 3 → 不弃 ──
  it('弃牌阶段:手牌=体力上限(3)时不触发弃牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2', 'c3'],
          health: 3,
          maxHealth: 3,
          skills: ['界英姿', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '闪', '♦', '4'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('回合管理', 'end', {});

    // 上限=体力上限=3,手牌=3 → 无需弃牌,无 __弃牌 pending
    expect(currentRequestType(harness.state)).not.toBe('__弃牌');
    expect(harness.state.players[0].hand.length).toBe(3);
  });

  // ─── 3. 体力<上限时上限仍=体力上限:health=1,maxHealth=3,手牌 3 → 不弃 ──
  it('弃牌阶段:体力(1)<体力上限(3)时,手牌 3 仍不弃(按体力上限)', async () => {
    const state: GameState = createGameState({
      players: [
        // health=1,maxHealth=3:若按"体力"上限应弃 2;按"体力上限"不弃
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2', 'c3'],
          health: 1,
          maxHealth: 3,
          skills: ['界英姿', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '闪', '♦', '4'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('回合管理', 'end', {});

    // 上限=体力上限=3(非体力 1),手牌=3 → 无需弃牌
    expect(currentRequestType(harness.state)).not.toBe('__弃牌');
    expect(harness.state.players[0].hand.length).toBe(3);
  });

  // ─── 4. 手牌>体力上限才弃:health=1,maxHealth=3,手牌 4 → 弃 1 ──
  it('弃牌阶段:手牌>体力上限时只弃超出部分(health=1,maxHealth=3,手牌4→弃1)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2', 'c3', 'c4'],
          health: 1,
          maxHealth: 3,
          skills: ['界英姿', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '过河拆桥', '♠', '3', '锦囊牌'),
        c4: makeCard('c4', '闪', '♦', '4'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('回合管理', 'end', {});

    // 上限=体力上限=3,手牌=4 → 只弃 1(excess=1;若按体力 1 则应弃 3)
    expect(currentRequestType(harness.state)).toBe('__弃牌');
    expect(discardExcess(harness.state)).toBe(1);

    await P0.respond('系统规则', { cardIds: ['c4'] });
    expect(harness.state.players[0].hand.length).toBe(3);
  });

  // ─── 5. 集成:开局摸 3 → 结束回合 → 弃牌按体力上限(3)结算 ───
  it('集成:锁定技摸3 → 结束回合 → 弃牌阶段按体力上限(3)结算', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const d3 = makeCard('d3', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        // HP=3,maxHealth=3,初始手牌 1;锁定技摸 3 → 手牌 4;上限=体力上限=3 → 弃 1
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          health: 3,
          maxHealth: 3,
          skills: ['界英姿', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        d1,
        d2,
        d3,
      },
      zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 开局 → 锁定技自动摸 3(手牌 4),无询问
    await P0.triggerAction('回合管理', 'start');
    expect(harness.state.players[0].hand.length).toBe(4);
    expect(hasYingziConfirm(harness.state)).toBe(false);

    // 结束出牌阶段 → 弃牌阶段:上限=体力上限=3,手牌 4 → 只弃 1
    await P0.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).toBe('__弃牌');
    expect(discardExcess(harness.state)).toBe(1);
  });
});
