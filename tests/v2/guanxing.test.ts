import { describe, it, expect } from 'vitest';
import { safeEngine as engine } from './invariants';
import {
  getCharacterMap,
  createTestGame,
} from './setup';
import { registerCharacterTriggers, emitEvent } from '@engine/v2/skill';
import type { GameState } from '@engine/v2/types';

const charMap = getCharacterMap();

function withTriggers(state: GameState, ...players: string[]): GameState {
  let s = state;
  for (const p of players) {
    s = registerCharacterTriggers(s, p, { characterMap: charMap });
  }
  return s;
}

function triggerPhaseBegin(state: GameState, player: string, phase: string) {
  return emitEvent(state, { type: 'phaseBegin', phase: phase as any, player });
}

describe('观星技能', () => {
  it('准备阶段触发观星后产生 prompt pending', () => {
    let state = createTestGame({ characters: ['诸葛亮', '曹操'] });
    state = withTriggers(state, 'P1');
    state = { ...state, phase: '准备' };

    const result = triggerPhaseBegin(state, 'P1', '准备');

    expect(result.error).toBeUndefined();
    expect(result.state.pending).not.toBeNull();
    expect(result.state.pending!.type).toBe('skillPrompt');
    const prompt = result.state.pending as any;
    expect(prompt.prompt.text).toContain('观星');
    expect(prompt.prompt.options).toHaveLength(2);
  });

  it('逐张选择牌堆顶/底后正确重排牌堆', () => {
    let state = createTestGame({ characters: ['诸葛亮', '曹操'] });
    state = withTriggers(state, 'P1');
    state = { ...state, phase: '准备' };

    const deckBefore = [...state.zones.deck];
    expect(deckBefore.length).toBeGreaterThanOrEqual(2);

    let result = triggerPhaseBegin(state, 'P1', '准备');
    expect(result.error).toBeUndefined();
    expect(result.state.pending!.type).toBe('skillPrompt');

    // 第 1 张 → 牌堆底
    result = engine(result.state, {
      type: 'skillChoice',
      player: 'P1',
      choice: 'bottom',
    });
    expect(result.error).toBeUndefined();

    // 2 人游戏 N=2 → 还有第 2 张 prompt
    if (result.state.pending?.type === 'skillPrompt') {
      result = engine(result.state, {
        type: 'skillChoice',
        player: 'P1',
        choice: 'top',
      });
      expect(result.error).toBeUndefined();
    }

    const deckAfter = result.state.zones.deck;
    expect(deckAfter.length).toBe(deckBefore.length);
    // 第 1 张→bottom, 第 2 张→top → 新牌堆 = [card1, ...remaining, card0]
    expect(deckAfter[0]).toBe(deckBefore[1]);
    expect(deckAfter[deckAfter.length - 1]).toBe(deckBefore[0]);
  });

  it('所有牌放牌堆顶时牌堆顺序不变', () => {
    let state = createTestGame({ characters: ['诸葛亮', '曹操'] });
    state = withTriggers(state, 'P1');
    state = { ...state, phase: '准备' };

    const deckBefore = [...state.zones.deck];

    let result = triggerPhaseBegin(state, 'P1', '准备');

    result = engine(result.state, {
      type: 'skillChoice',
      player: 'P1',
      choice: 'top',
    });

    if (result.state.pending?.type === 'skillPrompt') {
      result = engine(result.state, {
        type: 'skillChoice',
        player: 'P1',
        choice: 'top',
      });
    }

    expect(result.state.zones.deck).toEqual(deckBefore);
  });

  it('所有牌放牌堆底时顺序正确', () => {
    let state = createTestGame({ characters: ['诸葛亮', '曹操'] });
    state = withTriggers(state, 'P1');
    state = { ...state, phase: '准备' };

    const deckBefore = [...state.zones.deck];
    const N = 2;

    let result = triggerPhaseBegin(state, 'P1', '准备');

    result = engine(result.state, {
      type: 'skillChoice',
      player: 'P1',
      choice: 'bottom',
    });

    if (result.state.pending?.type === 'skillPrompt') {
      result = engine(result.state, {
        type: 'skillChoice',
        player: 'P1',
        choice: 'bottom',
      });
    }

    const deckAfter = result.state.zones.deck;
    expect(deckAfter).toEqual([
      ...deckBefore.slice(N),
      ...deckBefore.slice(0, N),
    ]);
  });

  it('5 人游戏 N = min(5, 5) = 5', () => {
    let state = createTestGame({
      playerCount: 5,
      characters: ['诸葛亮', '曹操', '刘备', '孙权', '华佗'],
    });
    state = withTriggers(state, 'P1');
    state = { ...state, phase: '准备' };

    const deckBefore = [...state.zones.deck];

    let result = triggerPhaseBegin(state, 'P1', '准备');

    const choices = ['top', 'bottom', 'top', 'top', 'bottom'];
    for (const choice of choices) {
      expect(result.state.pending?.type).toBe('skillPrompt');
      result = engine(result.state, {
        type: 'skillChoice',
        player: 'P1',
        choice,
      });
      expect(result.error).toBeUndefined();
    }

    const deckAfter = result.state.zones.deck;
    // top: [0, 2, 3], bottom: [1, 4]
    const expectedDeck = [
      deckBefore[0], deckBefore[2], deckBefore[3],
      ...deckBefore.slice(5),
      deckBefore[1], deckBefore[4],
    ];
    expect(deckAfter).toEqual(expectedDeck);
  });

  it('牌堆为空时 handler 返回空数组', () => {
    let state = createTestGame({ characters: ['诸葛亮', '曹操'] });
    state = withTriggers(state, 'P1');
    state = { ...state, phase: '准备', zones: { deck: [], discardPile: [] } };

    const result = triggerPhaseBegin(state, 'P1', '准备');

    expect(result.error).toBeUndefined();
    expect(result.state.pending).toBeNull();
  });
});
