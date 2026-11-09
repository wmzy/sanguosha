import { describe, expect, it } from 'vitest';
import { createGameState } from '../../src/engine/types';
import { flipFaceDown, flipFaceUp, isFaceDown, setFaceDown } from '../../src/engine/flows/face-down';
import type { PlayerState } from '../../src/engine/types';
import { SkillTestHarness } from '../engine-harness';

function makePlayer(index: number): PlayerState {
  return {
    index,
    name: `P${index}`,
    character: '曹丕',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [],
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('翻面流程', () => {
  it('翻面在共享正反面间切换，不叠加标签；设置背面保持幂等', async () => {
    const harness = new SkillTestHarness();
    await harness.setup(createGameState({ players: [makePlayer(0), makePlayer(1)], cardMap: {} }));
    const state = harness.state;

    await flipFaceDown(state, 0, '放逐');
    expect(isFaceDown(state, 0)).toBe(true);
    await flipFaceDown(state, 0, '悲歌');
    expect(isFaceDown(state, 0)).toBe(false);
    expect(state.players[0].tags.filter((tag) => tag.endsWith('/翻面'))).toEqual([]);

    await setFaceDown(state, 0, '放逐');
    await setFaceDown(state, 0, '悲歌');
    expect(state.players[0].tags.filter((tag) => tag.endsWith('/翻面'))).toEqual(['放逐/翻面']);

    await flipFaceUp(state, 0, '放逐');
    expect(isFaceDown(state, 0)).toBe(false);
  });
});
