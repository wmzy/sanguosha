// 界屯田(界邓艾·被动技)验证测试
//   核心差异:回合内弃置杀时也触发(标版仅回合外失去牌)。
//
// 验证:
//   1. 回合内弃置杀 → 屯田触发 → 判定非红桃 → 加田
//   2. 回合内弃置非杀 → 不触发
//   3. 回合外失去牌 → 触发(标版行为保持)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, makeCard, makePlayer as sharedMakePlayer } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { GameState, PlayerState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}): PlayerState {
  return sharedMakePlayer({ ...opts, character: opts.character ?? '界邓艾' });
}

describe('界屯田', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 回合内弃置杀 → 屯田触发 → 加田 ────────────────────
  it('回合内弃置杀 → 判定非红桃 → 加田标记 + 距离修正', async () => {

    const sha = makeCard('sha', '杀', '♠', '5');
    const judge = makeCard('j1', '杀', '♠', '7'); // 非红桃
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['sha'], skills: ['界屯田'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { sha, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      // P0 自己的回合
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P0 在自己回合内弃置杀
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['sha'] });
    await harness.waitForStable();

    // 屯田询问发动
    P0.expectPending('请求回应');
    await P0.respond('界屯田', { choice: true });
    await harness.waitForStable();

    // 判定非红桃 → 加田标记
    const tianMarks = harness.state.players[0].marks.filter((m) =>
      m.id.startsWith('屯田/田:'),
    );
    expect(tianMarks.length).toBe(1);
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(1);

  });

  // ─── 回合内弃置非杀 → 不触发 ────────────────────
  it('回合内弃置非杀(闪):屯田不触发', async () => {

    const shan = makeCard('shan', '闪', '♣', '5');
    const judge = makeCard('j1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['shan'], skills: ['界屯田'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { shan, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P0 在自己回合内弃置闪(非杀)
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['shan'] });
    await harness.waitForStable();

    // 屯田不触发
    expect(harness.state.pendingSlots.size).toBe(0);
    const tianMarks = harness.state.players[0].marks.filter((m) =>
      m.id.startsWith('屯田/田:'),
    );
    expect(tianMarks.length).toBe(0);

  });

  // ─── 回合外失去牌 → 触发(标版行为保持)────────────
  it('回合外被获得牌 → 判定非红桃 → 加田标记', async () => {

    const p0card = makeCard('p0c', '杀', '♠', '5');
    const judge = makeCard('j1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['p0c'], skills: ['界屯田'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { p0c: p0card, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '获得', player: 1, cardId: 'p0c', from: 0 });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界屯田', { choice: true });
    await harness.waitForStable();

    const tianMarks = harness.state.players[0].marks.filter((m) =>
      m.id.startsWith('屯田/田:'),
    );
    expect(tianMarks.length).toBe(1);

  });
});
