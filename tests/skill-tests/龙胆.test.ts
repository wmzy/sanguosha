// 龙胆(赵云·转化技)测试:
//   杀当闪(防御):被询问闪时,preceding=[龙胆.transform{to:'闪'}] + 闪.respond
//   闪当杀(进攻):自己回合,transformThenUse 龙胆{to:'杀'} + 杀.use
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
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
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '赵云',
    health: opts.health ?? 4,
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

describe('龙胆', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 闪当杀(进攻):自己回合,闪→杀 ─────────────────────────────
  it('闪当杀:赵云把闪当杀使用 → P2 扣血', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['龙胆', '杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 转化闪→杀 + 出杀
    await P1.transformThenUse(
      '龙胆',
      { cardId: 'd1', to: '杀' },
      '杀',
      { cardId: 'd1#龙胆', targets: [1] },
    );

    // 影子卡已建立
    expect(harness.state.cardMap['d1#龙胆'].name).toBe('杀');
    expect(harness.state.cardMap['d1#龙胆'].shadowOf).toBe('d1');

    // P2 不闪 → 扣血
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
    // 原卡 d1(影子还原)进弃牌堆
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  // ─── 杀当闪(防御):被询问闪时,杀→闪 ─────────────────────────────
  it('杀当闪:赵云被杀时把杀当闪打出 → 不扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const kill2 = makeCard('k2', '杀', '♣', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['k2'], skills: ['龙胆', '闪'] }),
      ],
      cardMap: { k1: kill, k2: kill2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀 → 流程停在 询问闪(P2)
    await P1.useCardAndTarget('杀', 'k1', [1]);
    P2.expectPending('询问闪');

    // P2 用龙胆:杀(k2)→闪,preceding + 闪.respond
    await P2.tryDispatch({
      skillId: '闪',
      actionType: 'respond',
      params: { cardId: 'k2#龙胆' },
      preceding: [{ skillId: '龙胆', actionType: 'transform', params: { cardId: 'k2', to: '闪' } }],
    });
    await harness.waitForStable();
    harness.processAllEvents();

    // 杀被闪抵消 → P2 不扣血
    expect(harness.state.players[1].health).toBe(4);
    // 原卡 k2(影子还原)+ P1 的杀 k1 进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k2');
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── 负面:转化方向与原卡不符 ─────────────────────────────
  it('transform:to=杀 但原卡是杀 → 拒绝(只能将闪当杀)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['龙胆'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '龙胆',
      actionType: 'transform',
      params: { cardId: 'k1', to: '杀' },
    });
  });

  it('transform:to=闪 但原卡是闪 → 拒绝(只能将杀当闪)', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['龙胆'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '龙胆',
      actionType: 'transform',
      params: { cardId: 'd1', to: '闪' },
    });
  });

  // ─── 负面:不在手牌 ─────────────────────────────
  it('transform:牌不在手牌 → 拒绝', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['龙胆'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '龙胆',
      actionType: 'transform',
      params: { cardId: 'k1', to: '闪' },
    });
  });

  // ─── rollback:转化后主 action 失败 → 原卡还原 ──────────────────
  it('rollback:闪当杀但无目标 → 杀.validate 失败,原卡还原', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['龙胆', '杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 无 targets → 杀.use validate 失败 → rollback 龙胆 transform
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: {
        cardId: 'd1#龙胆',
        preceding: [{ skillId: '龙胆', actionType: 'transform', params: { cardId: 'd1', to: '杀' } }],
      },
    });

    // 状态还原:d1 仍是闪,影子不存在,手牌仍是 d1
    expect(harness.state.cardMap['d1'].name).toBe('闪');
    expect(harness.state.cardMap['d1#龙胆']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['d1']);
  });
});
