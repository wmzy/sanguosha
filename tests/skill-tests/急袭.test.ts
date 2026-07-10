// 急袭(邓艾·转化技,由"凿险"觉醒获得):你可以将一张"田"当【顺手牵羊】使用。
//
// 模型(组合 action):preceding=[急袭.transform] + 主 action=顺手牵羊.use
//   transform:选一张田 → 去标记(移除田) → 创建影子"顺手牵羊"入对手牌 → 更新距离修正
//   顺手牵羊.use:读手牌中的影子卡,正常流程执行
//
// 验证:
//   1. 正面:将田当顺手牵羊使用 → 获得目标牌 + 田被消耗
//   2. 正面:田减少后距离修正更新
//   3. 负面:无田时 transform 被拒绝
//   4. 负面:指定的 markId 不存在 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  marks?: Array<{ id: string; scope: number; payload?: Record<string, unknown> }>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
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
  };
}

describe('急袭', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:将田当顺手牵羊使用 → 获得目标牌 ─────────────────────

  it('正面:将田当顺手牵羊使用 → 获得目标手牌 + 田被消耗', async () => {
    const restoreAutoCompare = disableAutoCompare();
    // 判定牌(田的来源)
    const judgeCard = makeCard('jc1', '杀', '♣', '5');
    // P1 的手牌(被顺手牵羊的目标)
    const p1Card = makeCard('p1c', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['急袭', '顺手牵羊'],
          marks: [{ id: '屯田/田:1', scope: 0, payload: { cardId: 'jc1' } }],
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['p1c'], skills: [] }),
      ],
      cardMap: { jc1: judgeCard, p1c: p1Card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const p0HandBefore = harness.state.players[0].hand.length;
    const p1HandBefore = harness.state.players[1].hand.length;

    // 急袭转化:田 → 顺手牵羊,然后使用
    await P0.transformThenUse(
      '急袭',
      { markId: '屯田/田:1' },
      '顺手牵羊',
      { cardId: '屯田/田:1#急袭', targets: [1] },
    );

    // 田被消耗
    expect(harness.state.players[0].marks.filter((m) => m.id.startsWith('屯田/田:'))).toHaveLength(0);

    // 无懈可击窗口 → 无人打无懈
    await P0.pass();
    // 选牌窗口 → 超时默认选第一张手牌
    await P0.pass();

    // P0 获得 P1 的手牌
    expect(harness.state.players[0].hand).toContain('p1c');
    expect(harness.state.players[1].hand).not.toContain('p1c');
    // 影子卡还原(判定牌进弃牌堆)
    expect(harness.state.zones.discardPile).toContain('jc1');
    restoreAutoCompare();
  });

  // ─── 正面:田减少后距离修正更新 ───────────────────────────────

  it('正面:消耗田后距离修正 vars 更新', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const judgeCard1 = makeCard('jc1', '杀', '♣', '5');
    const judgeCard2 = makeCard('jc2', '杀', '♠', '3');
    const p1Card = makeCard('p1c', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        {
          ...makePlayer({
            index: 0,
            name: 'P0',
            hand: [],
            skills: ['急袭', '顺手牵羊'],
            marks: [
              { id: '屯田/田:1', scope: 0, payload: { cardId: 'jc1' } },
              { id: '屯田/田:2', scope: 0, payload: { cardId: 'jc2' } },
            ],
          }),
          // 模拟屯田技能已设置的距离修正(2张田 = 进攻修正 +2)
          vars: { '距离/进攻修正': 2 },
        },
        makePlayer({ index: 1, name: 'P1', hand: ['p1c'], skills: [] }),
      ],
      cardMap: { jc1: judgeCard1, jc2: judgeCard2, p1c: p1Card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 初始:2张田 → 距离/进攻修正 = 2
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(2);

    const P0 = harness.player('P0');
    await P0.transformThenUse(
      '急袭',
      { markId: '屯田/田:1' },
      '顺手牵羊',
      { cardId: '屯田/田:1#急袭', targets: [1] },
    );

    // 消耗1张田后:距离/进攻修正 = 1
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(1);
    expect(harness.state.players[0].marks.filter((m) => m.id.startsWith('屯田/田:'))).toHaveLength(1);

    // 完成顺手牵羊流程
    await P0.pass(); // 无懈
    await P0.pass(); // 选牌
    restoreAutoCompare();
  });

  // ─── 负面:无田时 transform 被拒绝 ────────────────────────────

  it('负面:无田时使用急袭 → transform 被拒绝', async () => {
    const p1Card = makeCard('p1c', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['急袭', '顺手牵羊'],
          marks: [], // 无田
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['p1c'], skills: [] }),
      ],
      cardMap: { p1c: p1Card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: '屯田/田:1#急袭', targets: [1] },
      preceding: [{ skillId: '急袭', actionType: 'transform', params: { markId: '屯田/田:1' } }],
    });

    // 状态不变:无田、无影子卡
    expect(harness.state.players[0].marks).toHaveLength(0);
    expect(harness.state.cardMap['屯田/田:1#急袭']).toBeUndefined();
  });

  // ─── 负面:指定的 markId 不存在 → 拒绝 ────────────────────────

  it('负面:指定的 markId 不存在 → 拒绝', async () => {
    const judgeCard = makeCard('jc1', '杀', '♣', '5');
    const p1Card = makeCard('p1c', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['急袭', '顺手牵羊'],
          marks: [{ id: '屯田/田:1', scope: 0, payload: { cardId: 'jc1' } }],
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['p1c'], skills: [] }),
      ],
      cardMap: { jc1: judgeCard, p1c: p1Card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 指定不存在的 markId
    await P0.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: '屯田/田:999#急袭', targets: [1] },
      preceding: [{ skillId: '急袭', actionType: 'transform', params: { markId: '屯田/田:999' } }],
    });

    // 原田未被消耗
    expect(harness.state.players[0].marks.filter((m) => m.id.startsWith('屯田/田:'))).toHaveLength(1);
  });
});
