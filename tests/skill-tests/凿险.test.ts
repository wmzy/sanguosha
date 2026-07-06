// 凿险(邓艾·觉醒技)+ 急袭(转化技)测试
//   凿险:准备阶段,若"田"的数量≥3,你须减1点体力上限,然后获得技能"急袭"。
//   急袭:将一张"田"当【顺手牵羊】使用。
//
// 验证:
//   1. 凿险觉醒:田≥3 → 减上限 + 获得急袭
//   2. 凿险不触发:田<3
//   3. 凿险不触发:已觉醒
//   4. 急袭:田→顺手牵羊 → 获得目标一张牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, Faction, GameState, Mark, PlayerState } from '../../src/engine/types';

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
  character?: string;
  marks?: Mark[];
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '邓艾',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: opts.marks ?? [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: '魏',
  };
}

/** 构造田标记 */
function makeTian(seq: number, cardId: string): Mark {
  return { id: `屯田/田:${seq}`, scope: 0, payload: { cardId } };
}

describe('凿险 + 急袭', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 凿险觉醒:田≥3 → 减上限 + 获得急袭 ────────────────────
  it('准备阶段 田≥3 → 减1体力上限 + 获得急袭', async () => {
    // 凿险更新 vars(距离修正)无 atom 通道,关闭自动对比
    const restoreAutoCompare = disableAutoCompare();

    // 3 张田(对应 3 张判定牌的 cardId)
    const tianCards = ['tc1', 'tc2', 'tc3'];
    const cardMap: Record<string, Card> = {};
    for (const id of tianCards) cardMap[id] = makeCard(id, '杀', '♠', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['屯田', '凿险'],
          health: 4,
          maxHealth: 4,
          marks: tianCards.map((id, i) => makeTian(i + 1, id)),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 2, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    // 触发准备阶段开始
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    // 凿险觉醒:体力上限 4→3
    expect(harness.state.players[0].maxHealth).toBe(3);
    // 获得急袭技能
    expect(harness.state.players[0].skills).toContain('急袭');
    // 觉醒标记
    expect(harness.state.players[0].vars['凿险/awakened']).toBe(true);

    restoreAutoCompare();
  });

  // ─── 凿险不触发:田<3 ────────────────────
  it('准备阶段 田=2 → 不觉醒', async () => {
    const restoreAutoCompare = disableAutoCompare();

    const tianCards = ['tc1', 'tc2'];
    const cardMap: Record<string, Card> = {};
    for (const id of tianCards) cardMap[id] = makeCard(id, '杀', '♠', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['屯田', '凿险'],
          health: 4,
          maxHealth: 4,
          marks: tianCards.map((id, i) => makeTian(i + 1, id)),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 2, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    // 不觉醒:上限不变,无急袭
    expect(harness.state.players[0].maxHealth).toBe(4);
    expect(harness.state.players[0].skills).not.toContain('急袭');
    expect(harness.state.players[0].vars['凿险/awakened']).toBeUndefined();

    restoreAutoCompare();
  });

  // ─── 凿险不触发:已觉醒 ────────────────────
  it('已觉醒 → 再次准备阶段不触发', async () => {
    const restoreAutoCompare = disableAutoCompare();

    const tianCards = ['tc1', 'tc2', 'tc3'];
    const cardMap: Record<string, Card> = {};
    for (const id of tianCards) cardMap[id] = makeCard(id, '杀', '♠', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['屯田', '凿险'],
          health: 3,
          maxHealth: 3, // 已觉醒(上限已减)
          marks: tianCards.map((id, i) => makeTian(i + 1, id)),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 3, phase: '准备', vars: {} },
    });
    // 预设已觉醒标记
    state.players[0].vars['凿险/awakened'] = true;
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    // 不重复觉醒:上限不变(仍为 3)
    expect(harness.state.players[0].maxHealth).toBe(3);

    restoreAutoCompare();
  });

  // ─── 急袭:田→顺手牵羊 → 获得目标一张牌 ────────────────────
  it('急袭:消耗一张田当顺手牵羊 → 获得目标手牌', async () => {
    const restoreAutoCompare = disableAutoCompare();

    // P0(邓艾)已觉醒,有急袭技能 + 3 张田 + 距离 1 内有目标
    // P1 有一张手牌(目标牌)
    const targetCard = makeCard('p1c', '杀', '♠', '5');
    // 田的 cardId
    const tianCardId = 'tc1';
    const cardMap: Record<string, Card> = {
      p1c: targetCard,
      tc1: makeCard(tianCardId, '杀', '♣', '3'),
    };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['屯田', '凿险', '急袭', '顺手牵羊'],
          health: 3,
          maxHealth: 3,
          marks: [makeTian(1, tianCardId)],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1c'],
          faction: '魏',
        }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 2, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 分步执行 transform + use(不用 transformThenUse,避免 fire-and-forget 时序问题)
    // 1. transform:田 → 影子顺手牵羊
    await P0.tryDispatch({
      skillId: '急袭', actionType: 'transform', params: { markId: '屯田/田:1' },
    });

    // 2. use:影子卡当顺手牵羊使用
    await P0.triggerAction('顺手牵羊', 'use', { cardId: '屯田/田:1#急袭', target: 1 });
    // 3. 消耗无懈窗口(P1 无无懈可击牌 → pass)
    await P0.pass();
    // 4. 选牌窗口:P0 选 P1 手牌[0]
    await P0.respond('顺手牵羊', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();

    // 顺手牵羊执行后,P0 获得了 P1 的手牌(p1c)
    // P1 手牌被拿走
    expect(harness.state.players[1].hand).not.toContain('p1c');
    // P0 手牌中应有 p1c(或其原卡)
    expect(harness.state.players[0].hand.length).toBeGreaterThan(0);

    // 田被消耗
    const remainingTian = harness.state.players[0].marks.filter(
      (m) => m.id.startsWith('屯田/田:'),
    ).length;
    expect(remainingTian).toBe(0);

    restoreAutoCompare();
  });
});
