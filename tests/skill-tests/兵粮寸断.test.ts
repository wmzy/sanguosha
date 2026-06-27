// tests/skill-tests/兵粮寸断.test.ts
// 兵粮寸断(延时锦囊):对距离1以内一名其他角色使用。
//   判定:非梅花 → 跳过摸牌阶段;梅花 → 无效弃置。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, fireTimeoutAndWait, waitForStable } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json, PlayerState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: { index: number; name: string; hand?: string[]; skills?: string[]; pendingTricks?: Array<{ name: string; source: number; card: Card }>; tags?: string[] }): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {} as Record<string, Json>,
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    judgeZone: [],
    tags: opts.tags ?? [],
  };
}

describe('兵粮寸断', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. use action:对距离1以内的目标放置延时锦囊
  // ─────────────────────────────────────────────────────────────
  it('use action:对目标放置 兵粮寸断 延时锦囊', async () => {
    const card = makeCard('b1', '兵粮寸断', '♣');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['b1'], skills: ['兵粮寸断', '回合管理'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: { b1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    // P1 出 兵粮寸断(对距离1以内 P2);使用时不再问无懈
    await P1.triggerAction('兵粮寸断', 'use', { cardId: 'b1', target: 1 });

    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('兵粮寸断');
    expect(harness.state.players[1].pendingTricks[0].source).toBe(0);
    expect(harness.state.zones.discardPile).toContain('b1');
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 判定为梅花:无效,仅移除延时锦囊,不加跳过标签
  // ─────────────────────────────────────────────────────────────
  it('判定为梅花:移除延时锦囊,不加跳过标签', async () => {
    const card = makeCard('b1', '兵粮寸断', '♣');
    const judgeCard = makeCard('j1', '判定牌', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['兵粮寸断', '回合管理'],
          pendingTricks: [{ name: '兵粮寸断', source: 0, card }],
        }),
      ],
      cardMap: { b1: card, j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

    // 梅花 → 仅移除延时锦囊,不加跳过摸牌标签
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    const hasSkipTag = harness.state.players[1].tags?.includes('兵粮寸断/跳过摸牌');
    expect(hasSkipTag).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 判定为黑桃:加跳过摸牌标签,移除延时锦囊
  // ─────────────────────────────────────────────────────────────
  it('判定为黑桃:加跳过摸牌标签,移除延时锦囊', async () => {
    const card = makeCard('b1', '兵粮寸断', '♣');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['兵粮寸断', '回合管理'],
          pendingTricks: [{ name: '兵粮寸断', source: 0, card }],
        }),
      ],
      cardMap: { b1: card, j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    const hasSkipTag = harness.state.players[1].tags?.includes('兵粮寸断/跳过摸牌');
    expect(hasSkipTag).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // 4. 判定后 + 摸牌阶段开始 → cancel 摸牌阶段,标签清除
  // ─────────────────────────────────────────────────────────────
  it('跳过摸牌标签存在 → 摸牌阶段开始被 cancel,标签清除', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['兵粮寸断', '回合管理'],
          tags: ['兵粮寸断/跳过摸牌'],
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    const handBefore = harness.state.players[1].hand.length;
    await applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '摸牌' });

    // 标签被清除
    expect(harness.state.players[1].tags?.includes('兵粮寸断/跳过摸牌')).toBe(false);
    // 手牌没增加(被跳过)
    expect(harness.state.players[1].hand.length).toBe(handBefore);
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:目标超距离(距离>1)
  // ─────────────────────────────────────────────────────────────
  it('validate 拒绝:对距离>1 的目标使用', async () => {
    const card = makeCard('b1', '兵粮寸断', '♣');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['b1'], skills: ['兵粮寸断', '回合管理'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
        makePlayer({ index: 2, name: 'P3', skills: ['回合管理'] }),
        makePlayer({ index: 3, name: 'P4', skills: ['回合管理'] }),
        makePlayer({ index: 4, name: 'P5', skills: ['回合管理'] }),
      ],
      cardMap: { b1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    // P1 (index 0) 对 P3 (index 2) 距离 = 2(5人环:0→1→2 = 2,或 0→4→3→2 = 3,min=2)
    // 距离 2 > 1 → 应被拒绝
    await P1.expectRejected({
      skillId: '兵粮寸断', actionType: 'use',
      params: { cardId: 'b1', target: 2 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. 回合流转回归:判定阶段结束 → 摸牌被跳过 → 不摸牌且推进到出牌
  //    回归 bug:回合管理「阶段结束」after hook 在 applyAtom(阶段开始,摸牌) 被
  //    兵粮寸断 before hook cancel 后,仍无条件执行 摸牌(×2) 与 阶段结束(摸牌),
  //    导致兵粮寸断「跳过摸牌阶段」失效——判定生效后依然摸了牌。
  //    修复要点:after hook 应在推进阶段后校验当前实际 phase,被跳过则不再摸牌。
  // ─────────────────────────────────────────────────────────────
  it('回合流转:判定阶段结束 → 摸牌被跳过 → 不摸牌且推进到出牌', async () => {
    const c1 = makeCard('d1', '杀', '♠', '7', '基本牌');
    const c2 = makeCard('d2', '闪', '♥', '2', '基本牌');
    const c3 = makeCard('d3', '桃', '♥', '3', '基本牌');
    const c4 = makeCard('d4', '杀', '♣', '8', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['兵粮寸断', '回合管理'],
          tags: ['兵粮寸断/跳过摸牌'],
        }),
      ],
      cardMap: { d1: c1, d2: c2, d3: c3, d4: c4 },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] };
    await harness.setup(state);

    const handBefore = harness.state.players[1].hand.length;
    // 判定阶段结束 → 回合管理推进:阶段开始(摸牌)[被兵粮寸断 cancel]→出牌
    await applyAtom(harness.state, { type: '阶段结束', player: 1, phase: '判定' });

    // 摸牌阶段被跳过:手牌不增加
    expect(harness.state.players[1].hand.length).toBe(handBefore);
    // 标签清除
    expect(harness.state.players[1].tags?.includes('兵粮寸断/跳过摸牌')).toBe(false);
    // 阶段推进到出牌
    expect(harness.state.phase).toBe('出牌');
  });
});
