// 选将防提前结束测试:验证部分玩家选完后游戏不进入下一阶段。
// 引擎层保证 Promise.all(slotPromises) 在所有 slot resolve 前不会 resolve。
import { describe, it, expect, beforeEach } from 'vitest';
import { waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { bootstrap, dispatch, resetForTest } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';
import { allCharacters } from '../../src/engine/cards/characters';

const CHARACTERS = allCharacters.map((c) => ({
  name: c.name,
  skills: c.skills.map((s) => s.name),
}));

function makePlayer(index: number, name: string) {
  return {
    index,
    name,
    character: '',
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

async function respondCharSelect(state: GameState, target: number, character: string) {
  void dispatch(state, {
    skillId: '系统规则',
    actionType: '选将',
    ownerId: target,
    params: { character },
    baseSeq: 0,
  });
  await waitForStable(state);
}

async function waitForLordSlot(state: GameState) {
  for (let i = 0; i < 200 && state.pendingSlots.size === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await waitForStable(state);
}

describe('5 人选将防提前结束', () => {
  let state: GameState;

  beforeEach(() => {
    resetForTest();
    state = createGameState({
      players: [
        makePlayer(0, 'P1'),
        makePlayer(1, 'P2'),
        makePlayer(2, 'P3'),
        makePlayer(3, 'P4'),
        makePlayer(4, 'P5'),
      ],
      cardMap: {},
    });
    for (let i = 0; i < 60; i++) {
      const id = `deck_${i}`;
      state.cardMap[id] = { id, name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
      state.zones.deck.push(id);
    }
  });

  it('主公选完后,只 1 人选将时不应进入游戏', async () => {
    void bootstrap(state, { characters: CHARACTERS, playerCount: 5, seed: 42, gameId: 'test' });
    await waitForLordSlot(state);

    const lordSlot = [...state.pendingSlots.values()][0];
    const lordTarget = (lordSlot.atom as { target: number }).target;
    const lordCand = (lordSlot.atom as { candidates: Array<{ name: string }> }).candidates;
    await respondCharSelect(state, lordTarget, lordCand[0].name);
    await waitForStable(state);

    expect(state.pendingSlots.size).toBe(4);

    const targets = [...state.pendingSlots.keys()];
    const slot = state.pendingSlots.get(targets[0])!;
    const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates;
    await respondCharSelect(state, targets[0], cand[0].name);
    await waitForStable(state);

    expect(state.pendingSlots.size).toBe(3);
    expect(state.players.some((p) => p.hand.length > 0)).toBe(false);
  }, 15000);

  it('主公选完后,2 人选将时不应进入游戏', async () => {
    void bootstrap(state, { characters: CHARACTERS, playerCount: 5, seed: 42, gameId: 'test' });
    await waitForLordSlot(state);

    const lordSlot = [...state.pendingSlots.values()][0];
    const lordTarget = (lordSlot.atom as { target: number }).target;
    const lordCand = (lordSlot.atom as { candidates: Array<{ name: string }> }).candidates;
    await respondCharSelect(state, lordTarget, lordCand[0].name);
    await waitForStable(state);

    expect(state.pendingSlots.size).toBe(4);

    const targets = [...state.pendingSlots.keys()];
    for (let k = 0; k < 2; k++) {
      const slot = state.pendingSlots.get(targets[k])!;
      const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates;
      await respondCharSelect(state, targets[k], cand[0].name);
      await waitForStable(state);
    }

    expect(state.pendingSlots.size).toBe(2);
    expect(state.players.some((p) => p.hand.length > 0)).toBe(false);
  }, 15000);
});
