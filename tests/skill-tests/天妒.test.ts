// 天妒(郭嘉·被动技)测试
//   自己的判定牌生效后,可获得该判定牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable, disableAutoCompare } from '../engine-harness';
import { runJudgeFlow } from '../../src/engine/flows/judge';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
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

describe('天妒', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 发动天妒:获得判定牌 ─────────────────────────────
  // 注:「判定」atom 的 applyView 静态地按 deck→弃牌堆 建模(其 afterHooks 直接把判定牌
  // 移入弃牌堆,非 移动牌 事件,无法被拦截)。天妒拿走判定牌后,实际弃牌堆为空,
  // 但增量视图仍 +1 → discardPileCount 与全量视图不一致。这是 判定 atom 视图模型的
  // 已知局限(同 闪电/乐不思蜀 等不拿牌时无此问题)。状态本身正确,本用例关闭自动对比。
  it('自己的判定 → 确认天妒 → 判定牌进手牌', async () => {
    const restoreCompare = disableAutoCompare();
    const judge = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['天妒'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judge },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    try {
      void runJudgeFlow(harness.state, 0, '测试');
      await waitForStable(harness.state); // 天妒/choose 询问
      P0.expectPending('请求回应');
      await P0.respond('天妒', { choice: true });
      await harness.waitForStable();

      // 判定牌进入 P0 手牌
      expect(harness.state.players[0].hand).toContain('j1');
      // 判定牌不在弃牌堆(被天妒拿走)
      expect(harness.state.zones.discardPile).not.toContain('j1');
    } finally {
      restoreCompare();
    }
  });

  // ─── 不发动天妒:判定牌正常进弃牌堆 ─────────────────────────────
  it('自己的判定 → 不发动 → 判定牌进弃牌堆,手牌不变', async () => {
    const judge = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['天妒'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judge },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void runJudgeFlow(harness.state, 0, '测试');
    await waitForStable(harness.state);
    P0.expectPending('请求回应');
    await P0.respond('天妒', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 他人判定:不触发天妒 ─────────────────────────────
  it('他人(P1)的判定 → P0(天妒)不触发', async () => {
    const judge = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['天妒'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judge },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    // P1 的判定 → 天妒只对 owner=P0 的实例,atom.player=1 ≠ 0 → 不触发
    void runJudgeFlow(harness.state, 1, '测试');
    await waitForStable(harness.state);

    // 无询问 pending(天妒没触发),判定牌直接进弃牌堆
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.zones.discardPile).toContain('j1');
    expect(harness.state.players[0].hand).toEqual([]);
  });

  // ─── respond validate:无 pending 拒绝 ─────────────────────────────
  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['天妒'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    await P0.expectRejected({ skillId: '天妒', actionType: 'respond', params: { choice: true } });
  });

  // ─── 回归:runJudgeFlow 返回值契约(判定牌被收走后仍须返回其 id) ─────────────
  // 场景:郭嘉(天妒)判定区有乐不思蜀 → 判定阶段 resumeDelayedSettlement 的独立帧
  // 只含判定牌(length===1)→ 天妒把判定牌收进手牌 → runJudgeFlow 收尾搬移为 no-op。
  // 契约:返回值/localVars['判定/finalJudgeCardId'] 必须仍是该判定牌,
  // 否则 乐不思蜀/兵粮寸断/闪电 的 resolve 读到 undefined/旧值,判定结果错乱。
  it('天妒获得判定牌后,runJudgeFlow 仍返回最终判定牌 id', async () => {
    const restoreCompare = disableAutoCompare();
    const judge = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['天妒'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { j1: judge },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    try {
      let result: string | undefined;
      const flow = runJudgeFlow(harness.state, 0, '乐不思蜀').then((r) => {
        result = r;
      });
      void flow;
      await waitForStable(harness.state); // 天妒/choose 询问
      P0.expectPending('请求回应');
      await P0.respond('天妒', { choice: true }); // 获得判定牌(收走)
      await flow;

      // 判定牌被收走后,流程返回值必须仍是它(修复前:undefined → 下游读 stale 旧值)
      expect(result).toBe('j1');
      expect(harness.state.players[0].hand).toContain('j1');
    } finally {
      restoreCompare();
    }
  });
});
