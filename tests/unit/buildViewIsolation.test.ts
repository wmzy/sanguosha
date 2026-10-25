// buildView 的 turn 必须是快照：processedView 回放「回合结束」会写 view.turn.vars = {}，
// 若共享 state.turn 引用会清掉权威回合用量镜像，导致重连/增量视图漂移。
import { describe, it, expect } from 'vitest';
import { buildView } from '../../src/engine/view/buildView';
import { createGameState } from '../../src/engine/types';
import type { PlayerState } from '../../src/engine/types';

function makePlayer(index: number): PlayerState {
  return {
    index,
    name: `P${index}`,
    character: '',
    faction: '群',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [],
    equipment: {},
    pendingTricks: [],
    skills: [],
    vars: {},
    marks: [],
    tags: [],
  };
}

describe('buildView — turn 快照隔离', () => {
  it('修改 view.turn.vars 不得影响权威 state.turn.vars', () => {
    const state = createGameState({
      players: [makePlayer(0), makePlayer(1)],
      cardMap: {},
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: { '__view/0/杀/unlimited/测试': 1 } },
    });
    const view = buildView(state, 0);
    expect(view.turn.vars).toEqual({ '__view/0/杀/unlimited/测试': 1 });
    expect(view.turn).not.toBe(state.turn);
    view.turn.vars = {};
    expect(state.turn.vars).toEqual({ '__view/0/杀/unlimited/测试': 1 });
  });
});
