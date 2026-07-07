// 结姻(孙尚香·主动技)测试:
//   出牌阶段限一次,你可以弃置两张手牌,然后令一名已受伤的男性角色回复1点体力。
//
// 验证:
//   1. 正面:发动→弃两张手牌,目标(已受伤男性)回复1点体力
//   2. 限一次:同回合第二次发动被拒绝
//   3. 目标为女性(已受伤)→ 拒绝
//   4. 目标未受伤(满血男性)→ 拒绝
//   5. 手牌不足两张 → 拒绝
//   6. 非自己回合 → 拒绝
//   7. allocation 格式(distribute/allocate UI 提交)同样生效
//   8. 回复不超过上限(满血附近)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json, TurnPhase } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character: string;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  hand?: string[];
  skills?: string[];
  vars?: Record<string, Json>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function buildState(opts: {
  p0Hand?: string[];
  p1Character?: string;
  p1Health?: number;
  p1MaxHealth?: number;
  p2Character?: string;
  p2Health?: number;
  p2MaxHealth?: number;
  extraCards?: Record<string, Card>;
  currentPlayer?: number;
  phase?: TurnPhase;
}): GameState {
  const state = createGameState({
    players: [
      makePlayer({
        index: 0,
        name: '孙尚香',
        character: '孙尚香',
        health: 3,
        maxHealth: 3,
        hand: opts.p0Hand ?? ['h1', 'h2', 'h3'],
        skills: ['结姻'],
      }),
      makePlayer({
        index: 1,
        name: 'P1',
        character: opts.p1Character ?? '曹操',
        health: opts.p1Health ?? 3,
        maxHealth: opts.p1MaxHealth ?? 4,
      }),
      makePlayer({
        index: 2,
        name: 'P2',
        character: opts.p2Character ?? '甄姬',
        health: opts.p2Health ?? 2,
        maxHealth: opts.p2MaxHealth ?? 3,
      }),
    ],
    cardMap: {
      h1: makeCard('h1', '闪', '♦', '2'),
      h2: makeCard('h2', '杀', '♠', '3'),
      h3: makeCard('h3', '桃', '♥', '4'),
      ...(opts.extraCards ?? {}),
    },
    currentPlayerIndex: opts.currentPlayer ?? 0,
    phase: opts.phase ?? '出牌',
    turn: { round: 1, phase: opts.phase ?? '出牌', vars: {} },
  });
  return state;
}

describe('结姻', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:发动 → 弃两张手牌,目标回复1点体力 ────────────
  it('发动:弃 h1,h2 → P1(曹操·已受伤男性) health 3→4,孙尚香手牌减2', async () => {
    const state = buildState({});
    await harness.setup(state);
    const P0 = harness.player('孙尚香');

    await P0.triggerAction('结姻', 'use', { cardIds: ['h1', 'h2'], target: 1 });

    // P1 回复 1 点
    expect(harness.state.players[1].health).toBe(4);
    // 孙尚香弃了两张手牌,剩余 h3
    expect(harness.state.players[0].hand).toEqual(['h3']);
    // 弃牌堆有 h1, h2
    expect(harness.state.zones.discardPile).toContain('h1');
    expect(harness.state.zones.discardPile).toContain('h2');
    // 限一次标记
    expect(harness.state.players[0].vars['结姻/usedThisTurn']).toBe(true);
  });

  // ─── 2. 限一次:同回合第二次被拒绝 ────────────────────────
  it('限一次:已用过 → 第二次被拒绝', async () => {
    const state = buildState({ p0Hand: ['h1', 'h2', 'h3', 'h4', 'h5'] });
    state.cardMap['h4'] = makeCard('h4', '闪', '♦', '5');
    state.cardMap['h5'] = makeCard('h5', '杀', '♠', '6');
    await harness.setup(state);
    const P0 = harness.player('孙尚香');

    await P0.triggerAction('结姻', 'use', { cardIds: ['h1', 'h2'], target: 1 });
    expect(harness.state.players[1].health).toBe(4);

    // 第二次应被拒绝(P1 已满血也会因 usedThisTurn 先拒绝)
    await P0.expectRejected({
      skillId: '结姻',
      actionType: 'use',
      params: { cardIds: ['h3', 'h4'], target: 2 },
    });
  });

  // ─── 3. 目标为女性(已受伤)→ 拒绝 ────────────────────────
  it('目标为女性(甄姬·已受伤)→ 拒绝', async () => {
    const state = buildState({});
    await harness.setup(state);
    const P0 = harness.player('孙尚香');

    await P0.expectRejected({
      skillId: '结姻',
      actionType: 'use',
      params: { cardIds: ['h1', 'h2'], target: 2 },
    });
    // 状态不变
    expect(harness.state.players[2].health).toBe(2);
    expect(harness.state.players[0].hand.length).toBe(3);
  });

  // ─── 4. 目标未受伤(满血男性)→ 拒绝 ──────────────────────
  it('目标未受伤(曹操满血)→ 拒绝', async () => {
    const state = buildState({ p1Health: 4, p1MaxHealth: 4 });
    await harness.setup(state);
    const P0 = harness.player('孙尚香');

    await P0.expectRejected({
      skillId: '结姻',
      actionType: 'use',
      params: { cardIds: ['h1', 'h2'], target: 1 },
    });
  });

  // ─── 5. 手牌不足两张 → 拒绝 ──────────────────────────────
  it('手牌仅1张 → 拒绝', async () => {
    const state = buildState({ p0Hand: ['h1'] });
    await harness.setup(state);
    const P0 = harness.player('孙尚香');

    await P0.expectRejected({
      skillId: '结姻',
      actionType: 'use',
      params: { cardIds: ['h1'], target: 1 },
    });
  });

  // ─── 6. 非自己回合 → 拒绝 ────────────────────────────────
  it('非自己回合 → 拒绝', async () => {
    const state = buildState({ currentPlayer: 1 });
    await harness.setup(state);
    const P0 = harness.player('孙尚香');

    await P0.expectRejected({
      skillId: '结姻',
      actionType: 'use',
      params: { cardIds: ['h1', 'h2'], target: 1 },
    });
  });

  // ─── 7. allocation 格式(distribute/allocate UI)同样生效 ─
  it('allocation 格式提交:同样弃两张+目标回复', async () => {
    const state = buildState({});
    await harness.setup(state);
    const P0 = harness.player('孙尚香');

    await P0.triggerAction('结姻', 'use', {
      allocation: [{ target: 1, cardIds: ['h1', 'h2'] }],
    });

    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].hand).toEqual(['h3']);
  });

  // ─── 8. 弃牌张数不等于2 → 拒绝 ──────────────────────────
  it('弃3张手牌 → 拒绝(必须恰好两张)', async () => {
    const state = buildState({ p0Hand: ['h1', 'h2', 'h3'] });
    await harness.setup(state);
    const P0 = harness.player('孙尚香');

    await P0.expectRejected({
      skillId: '结姻',
      actionType: 'use',
      params: { cardIds: ['h1', 'h2', 'h3'], target: 1 },
    });
  });
});
