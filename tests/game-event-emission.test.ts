/**
 * tests/game-event-emission.test.ts — GameEvent 发射验证测试
 *
 * 验证 V2 引擎通过 engine() 真实路径发射 GameEvent，
 * 确保 damageReceived、killHit、killDodged、turnStart 等事件
 * 在实际游戏流程中被正确发射并触发技能。
 */
import { describe, it, expect } from 'vitest';
import { safeEngine as engine } from './invariants';
import {
  getCharacterMap,
  createTestGame,
  setPlayPhase,
  setHealth,
  injectCard,
  injectTrickCard,
  findCardInHand,
  passAllTrickResponders,
} from './engine-helpers';
import { registerCharacterTriggers } from '@engine/skill';
import type { GameState } from '@engine/types';

const charMap = getCharacterMap();

function withTriggers(state: GameState, ...players: string[]): GameState {
  let s = state;
  for (const p of players) {
    s = registerCharacterTriggers(s, p, { characterMap: charMap });
  }
  return s;
}

// ════════════════════════════════════════════════════════════════
// 杀响应事件：killHit / killDodged / damageReceived
// ════════════════════════════════════════════════════════════════

describe('GameEvent 发射: 杀响应', () => {
  it('杀→不闪→killHit ServerEvent + damageReceived 触发奸雄', () => {
    // P1(刘备) 出杀 → P2(曹操) 不闪 → damageReceived 触发奸雄拿回源牌
    let state = setPlayPhase(createTestGame({ characters: ['刘备', '曹操'], seed: 42 }));
    state = withTriggers(state, 'P2');
    state = injectCard(state, 'P1', '杀');
    const killId = findCardInHand(state, 'P1', '杀')!;
    const beforeP2Hand = state.players['P2'].hand.length;
    const beforeP2Health = state.players['P2'].health;

    // P1 对 P2(曹操) 出杀
    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: killId, target: 'P2' });
    expect(r1.error).toBeUndefined();
    expect(r1.state.pending?.type).toBe('responseWindow');

    // P2 不出闪
    const r2 = engine(r1.state, { type: 'respond', player: 'P2' });
    expect(r2.error).toBeUndefined();

    // killHit ServerEvent 被发射
    expect(r2.events.some(e => e.type === 'killHit')).toBe(true);
    // P2 受到 1 点伤害
    expect(r2.state.players['P2'].health).toBe(beforeP2Health - 1);
    // damageReceived GameEvent 触发了奸雄：P2(曹操)获得源牌（杀）
    expect(r2.state.players['P2'].hand.length).toBe(beforeP2Hand + 1);
  });

  it('杀→闪→killDodged ServerEvent 且不受伤', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectCard(state, 'P1', '杀');
    state = injectCard(state, 'P2', '闪');
    const killId = findCardInHand(state, 'P1', '杀')!;
    const dodgeId = findCardInHand(state, 'P2', '闪')!;
    const p2Health = state.players['P2'].health;

    // P1 对 P2 出杀
    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: killId, target: 'P2' });
    expect(r1.error).toBeUndefined();

    // P2 出闪
    const r2 = engine(r1.state, { type: 'respond', player: 'P2', cardId: dodgeId });
    expect(r2.error).toBeUndefined();

    // killDodged ServerEvent 被发射
    expect(r2.events.some(e => e.type === 'killDodged')).toBe(true);
    // P2 未受伤
    expect(r2.state.players['P2'].health).toBe(p2Health);
  });
});

// ════════════════════════════════════════════════════════════════
// 回合事件：turnStart
// ════════════════════════════════════════════════════════════════

describe('GameEvent 发射: 回合事件', () => {
  it('endTurn(无弃牌)→turnStart ServerEvent', () => {
    let state = setPlayPhase(createTestGame({ characters: ['刘备', '曹操'], seed: 42 }));
    state = withTriggers(state, 'P2');

    // P1 结束回合
    const r1 = engine(state, { type: 'endTurn', player: 'P1' });
    expect(r1.error).toBeUndefined();
    expect(r1.state.currentPlayer).toBe('P2');

    // turnStart ServerEvent 被发射
    expect(r1.events.some(e => e.type === 'turnStart')).toBe(true);
  });

  it('endTurn(弃牌后)→turnStart ServerEvent', () => {
    let state = setPlayPhase(createTestGame({ characters: ['刘备', '曹操'], seed: 42 }));
    state = withTriggers(state, 'P2');
    // P1 手牌 > 体力 → 强制弃牌
    state = setHealth(state, 'P1', 1);

    // P1 结束回合 → 进入弃牌阶段
    const r1 = engine(state, { type: 'endTurn', player: 'P1' });
    expect(r1.error).toBeUndefined();
    expect(r1.state.pending?.type).toBe('discardPhase');

    // P1 弃牌
    const hand = r1.state.players['P1'].hand;
    const discardCount = hand.length - r1.state.players['P1'].health;
    const r2 = engine(r1.state, {
      type: 'discard', player: 'P1',
      cardIds: hand.slice(0, discardCount),
    });
    expect(r2.error).toBeUndefined();

    // turnStart ServerEvent 被发射
    expect(r2.events.some(e => e.type === 'turnStart')).toBe(true);
    expect(r2.state.currentPlayer).toBe('P2');
  });
});

// ════════════════════════════════════════════════════════════════
// AOE 伤害事件：南蛮入侵/万箭齐发 → damageReceived
// ════════════════════════════════════════════════════════════════

describe('GameEvent 发射: AOE 伤害', () => {
  it('南蛮入侵→不出杀→damageReceived 触发奸雄', () => {
    // P1(刘备) 使用南蛮入侵 → P2(曹操) 不出杀 → damageReceived 触发奸雄
    let state = setPlayPhase(createTestGame({ characters: ['刘备', '曹操'], seed: 42 }));
    state = withTriggers(state, 'P2');
    state = injectTrickCard(state, 'P1', '南蛮入侵');
    const aoeCardId = findCardInHand(state, 'P1', '南蛮入侵')!;
    const beforeP2Hand = state.players['P2'].hand.length;
    const beforeP2Health = state.players['P2'].health;

    // P1 使用南蛮入侵
    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: aoeCardId });
    expect(r1.error).toBeUndefined();

    // 所有人 pass 过无懈可击窗口
    const afterWuxie = passAllTrickResponders(r1.state);

    // 确认进入 aoeResponse 阶段
    const pending = afterWuxie.pending;
    expect(pending?.type).toBe('responseWindow');
    if (pending?.type === 'responseWindow') {
      expect(pending.window.type).toBe('aoeResponse');
    }

    // P2 不出杀
    const r2 = engine(afterWuxie, { type: 'respond', player: 'P2' });
    expect(r2.error).toBeUndefined();

    // P2 受到 1 点伤害
    expect(r2.state.players['P2'].health).toBe(beforeP2Health - 1);
    // damageReceived 触发奸雄：P2(曹操)获得南蛮入侵牌
    expect(r2.state.players['P2'].hand.length).toBe(beforeP2Hand + 1);
  });
});

// ════════════════════════════════════════════════════════════════
// 决斗伤害事件 → damageReceived
// ════════════════════════════════════════════════════════════════

describe('GameEvent 发射: 决斗伤害', () => {
  it('决斗→不出杀→damageReceived 触发奸雄', () => {
    // P1(刘备) 使用决斗 → P2(曹操) 不出杀 → damageReceived 触发奸雄
    let state = setPlayPhase(createTestGame({ characters: ['刘备', '曹操'], seed: 42 }));
    state = withTriggers(state, 'P2');
    state = injectTrickCard(state, 'P1', '决斗');
    const duelCardId = findCardInHand(state, 'P1', '决斗')!;
    const beforeP2Hand = state.players['P2'].hand.length;
    const beforeP2Health = state.players['P2'].health;

    // P1 对 P2 使用决斗
    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: duelCardId, target: 'P2' });
    expect(r1.error).toBeUndefined();

    // 所有人 pass 过无懈可击窗口
    const afterWuxie = passAllTrickResponders(r1.state);

    // 确认进入 duelResponse 阶段
    const pending = afterWuxie.pending;
    expect(pending?.type).toBe('responseWindow');
    if (pending?.type === 'responseWindow') {
      expect(pending.window.type).toBe('duelResponse');
    }

    // P2 不出杀
    const r2 = engine(afterWuxie, { type: 'respond', player: 'P2' });
    expect(r2.error).toBeUndefined();

    // P2 受到 1 点伤害
    expect(r2.state.players['P2'].health).toBe(beforeP2Health - 1);
    // damageReceived 触发奸雄：P2(曹操)获得决斗牌
    expect(r2.state.players['P2'].hand.length).toBe(beforeP2Hand + 1);
  });
});
