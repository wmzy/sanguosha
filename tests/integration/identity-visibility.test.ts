// tests/integration/identity-visibility.test.ts
// 验证 buildView 对身份字段的可见性规则:
// - debug 模式:所有玩家身份全部可见
// - 非 debug 模式:仅自己/主公/死亡玩家身份可见,其他玩家身份隐藏
import { describe, it, expect } from 'vitest';
import { buildView } from '../../src/engine/view/buildView';
import type { GameState, PlayerState, Card } from '../../src/engine/types';

function makePlayer(
  index: number,
  identity: string,
  alive: boolean,
): PlayerState {
  return {
    index,
    name: `P${index}`,
    character: '测试',
    health: alive ? 4 : 0,
    maxHealth: 4,
    alive,
    hand: [],
    equipment: {},
    pendingTricks: [],
    skills: [],
    vars: { '身份': identity },
    marks: [],
    tags: [],
  };
}

function makeState(identities: string[], alive: boolean[] = identities.map(() => true)): GameState {
  const players = identities.map((id, i) => makePlayer(i, id, alive[i]));
  return {
    players,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    zones: { deck: [], discardPile: [], processing: [] },
    settlementStack: [],
    atomStack: [],
    cardMap: {} as Record<string, Card>,
    cardWrappers: {},
    rngSeed: 42,
    marks: [],
    localVars: {},
    meta: { gameId: 'test-room', createdAt: 0 },
    seq: 0,
    startedAt: 0,
    actionLog: [],
  };
}

describe('身份可见性规则', () => {
  it('debug 模式:所有玩家身份全部可见', () => {
    const state = makeState(['主公', '忠臣', '反贼', '内奸']);
    const view = buildView(state, 2, true);
    expect(view.players[0].identity).toBe('主公');
    expect(view.players[1].identity).toBe('忠臣');
    expect(view.players[2].identity).toBe('反贼');
    expect(view.players[3].identity).toBe('内奸');
    expect(view.players[0].identityHidden).toBe(false);
    expect(view.players[1].identityHidden).toBe(false);
    expect(view.players[2].identityHidden).toBe(false);
    expect(view.players[3].identityHidden).toBe(false);
  });

  it('非 debug 模式:自己身份可见', () => {
    const state = makeState(['主公', '忠臣', '反贼', '内奸']);
    const view = buildView(state, 2, false);
    expect(view.players[2].identity).toBe('反贼');
    expect(view.players[2].identityHidden).toBe(false);
  });

  it('非 debug 模式:主公身份对所有人公开', () => {
    const state = makeState(['主公', '忠臣', '反贼', '内奸']);
    const view = buildView(state, 3, false);
    expect(view.players[0].identity).toBe('主公');
    expect(view.players[0].identityHidden).toBe(false);
  });

  it('非 debug 模式:他人身份隐藏(显示为暗)', () => {
    const state = makeState(['主公', '忠臣', '反贼', '内奸']);
    const view = buildView(state, 2, false);
    expect(view.players[1].identity).toBeUndefined();
    expect(view.players[1].identityHidden).toBe(true);
    expect(view.players[3].identity).toBeUndefined();
    expect(view.players[3].identityHidden).toBe(true);
  });

  it('非 debug 模式:死亡玩家身份揭示', () => {
    const state = makeState(['主公', '忠臣', '反贼', '内奸'], [true, false, true, true]);
    const view = buildView(state, 3, false);
    // P1 死亡,即使是 P3 视角也能看到
    expect(view.players[1].identity).toBe('忠臣');
    expect(view.players[1].identityHidden).toBe(false);
    // P3(非自己、非主公、未死亡)对 P2 仍隐藏
    expect(view.players[2].identity).toBeUndefined();
    expect(view.players[2].identityHidden).toBe(true);
  });

  it('无身份玩家:identity 与 identityHidden 都是 undefined/false', () => {
    const state = makeState(['', '', '', '']);
    const view = buildView(state, 0, false);
    expect(view.players[1].identity).toBeUndefined();
    expect(view.players[1].identityHidden).toBe(false);
  });
});
