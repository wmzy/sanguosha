// 突袭(张辽·阶段替换技)测试
//   摸牌阶段:发动 → 选1~2名有手牌的其他角色 → 各获得一张随机手牌 → 跳过默认摸牌
//
// 通过 回合管理 触发完整的阶段推进:applyAtom(阶段结束, 判定) → 回合管理 →
//   阶段开始(摸牌) → 突袭 before hook。发动则偷牌+跳过摸牌;不发动/无目标则默认摸2张。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
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
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
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
    faction: '魏',
    identity: '主公',
  };
}

describe('突袭', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 发动突袭:选2名角色,各获得一张 ─────────────────────────────
  it('摸牌阶段发动突袭 → 选 P1/P2 → 各获得一张手牌,默认摸牌被跳过', async () => {
    const c1 = makeCard('a1', '杀', '♠', '7');
    const c2 = makeCard('a2', '闪', '♥', '5');
    const c3 = makeCard('a3', '桃', '♦', '3');
    const c4 = makeCard('a4', '酒', '♣', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['突袭', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['a1', 'a2'], skills: ['回合管理'] }),
        makePlayer({ index: 2, name: 'P2', hand: ['a3', 'a4'], skills: ['回合管理'] }),
      ],
      cardMap: { a1: c1, a2: c2, a3: c3, a4: c4 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    // 牌堆保留原 P1/P2 牌不参与(突袭不摸牌)
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 触发阶段推进:判定阶段结束 → 回合管理 → 摸牌阶段开始 → 突袭
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 突袭/trigger 询问
    P0.expectPending('请求回应');
    await P0.respond('突袭', { choice: true }); // 发动
    await waitForStable(harness.state); // 突袭/select 询问
    await P0.respond('突袭', { targets: [1, 2] });
    await harness.waitForStable();

    // P0 获得两张(各从 P1/P2 拿一张),没有从牌堆摸牌
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(1);
    // P0 拿到的牌来自 P1/P2 的手牌池
    const pool = new Set(['a1', 'a2', 'a3', 'a4']);
    for (const id of harness.state.players[0].hand) expect(pool.has(id)).toBe(true);
    // 拿到的牌不再属于原主
    for (const id of harness.state.players[0].hand) {
      expect(harness.state.players[1].hand).not.toContain(id);
      expect(harness.state.players[2].hand).not.toContain(id);
    }
  });

  // ─── 不发动突袭 → 默认摸牌 ─────────────────────────────
  it('不发动突袭 → 走默认摸牌(P0 手牌+2)', async () => {
    const d1 = makeCard('d1', '杀');
    const d2 = makeCard('d2', '闪', '♥');
    const c1 = makeCard('a1', '桃', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['突袭', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['a1'], skills: ['回合管理'] }),
      ],
      cardMap: { d1, d2, a1: c1 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '判定' });
    await waitForStable(harness.state);
    P0.expectPending('请求回应');
    await P0.respond('突袭', { choice: false }); // 不发动
    await harness.waitForStable();

    // 默认摸了2张(从牌堆 d1/d2)
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(new Set(harness.state.players[0].hand)).toEqual(new Set(['d1', 'd2']));
    // P1 手牌未受影响(未被偷)
    expect(harness.state.players[1].hand).toEqual(['a1']);
  });

  // ─── 无有效目标 → 不询问,直接默认摸牌 ─────────────────────────────
  it('其他角色都无手牌 → 突袭不发动,默认摸牌', async () => {
    const d1 = makeCard('d1', '杀');
    const d2 = makeCard('d2', '闪', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['突袭', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { d1, d2 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '判定' });
    await harness.waitForStable();

    // 无目标 → 不询问突袭 → 直接默认摸牌
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(new Set(harness.state.players[0].hand)).toEqual(new Set(['d1', 'd2']));
  });

  // ─── respond validate:无 pending 拒绝 ─────────────────────────────
  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['突袭'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    await P0.expectRejected({ skillId: '突袭', actionType: 'respond', params: { choice: true } });
  });
});
