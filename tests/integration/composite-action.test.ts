// tests/integration/composite-action.test.ts
// 组合 action 测试:武圣(转化) + 杀(使用)。
// 前端两步 UI、一次提交:preceding=[武圣.transform] + 主 action=杀.use。
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch, registerSkillsFromState, resetForTest, fireTimeout } from '../../src/engine/create-engine';
import { waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function buildState(): GameState {
  const red: Card = { id: 'c1', name: '桃园结义', suit: '♥', rank: 'A', type: '锦囊牌' };
  const dodge: Card = { id: 'c3', name: '闪', suit: '♣', rank: '2', type: '基本牌' };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '关羽', health: 4, maxHealth: 4, alive: true, hand: ['c1'], equipment: {}, skills: ['杀', '武圣'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: ['闪'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: { c1: red, c3: dodge },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('组合 action(武圣转化 + 杀使用)', () => {
  let state: GameState;
  beforeEach(async () => {
    resetForTest();
    state = buildState();
    await registerSkillsFromState(state);
  });

  it('武圣红牌当杀:preceding 转化后杀.use validate 通过,P2 扣血', async () => {
    // c1 是红桃锦囊(非杀),通过武圣转化为影子杀
    void dispatch(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: 'c1#武圣', targets: [1] }, baseSeq: 0,
      preceding: [{ skillId: '武圣', actionType: 'transform', params: { cardId: 'c1' } }],
    });
    await waitForStable(state);
    // 杀.execute 会 applyAtom 询问闪 → 进入 pending。需要 P2 respond(这里 pass 即不闪)。
    if (state.pendingSlots.size > 0) {
      await fireTimeout(state);
      await waitForStable(state);
    }
    expect(state.players[1].health).toBe(3);
    // 原卡 c1 进弃牌堆(影子 c1#武圣 在 移动牌 入弃牌堆时还原为 c1)
    expect(state.zones.discardPile).toContain('c1');
    expect(state.zones.discardPile).not.toContain('c1#武圣');
    // 影子已删除
    expect(state.cardMap['c1#武圣']).toBeUndefined();
    // 原卡仍在 cardMap
    expect(state.cardMap['c1']).toBeDefined();
    expect(state.cardMap['c1'].name).toBe('桃园结义'); // 原属性未变
  });

  it('preceding validate 失败(非红牌)→ 整个消息丢弃,无副作用', async () => {
    // 把 c1 换成黑桃
    state.cardMap['c1'] = { id: 'c1', name: '过河拆桥', suit: '♠', rank: '3', type: '锦囊牌' };
    const healthBefore = state.players[1].health;
    void dispatch(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: 'c1#武圣', targets: [1] }, baseSeq: 0,
      preceding: [{ skillId: '武圣', actionType: 'transform', params: { cardId: 'c1' } }],
    });
    await waitForStable(state);
    // preceding validate 失败 → 丢弃,c1 仍在手牌,无影子
    expect(state.players[0].hand).toContain('c1');
    expect(state.cardMap['c1#武圣']).toBeUndefined();
    expect(state.players[1].health).toBe(healthBefore);
  });

  it('主 action validate 失败(距离不够)→ rollback preceding(影子删除,手牌还原)', async () => {
    // 目标 99 不存在 → 杀.validate 失败 → rollback 武圣转化
    void dispatch(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: 'c1#武圣', targets: [99] }, baseSeq: 0,
      preceding: [{ skillId: '武圣', actionType: 'transform', params: { cardId: 'c1' } }],
    });
    await waitForStable(state);
    // rollback:影子删除,手牌还原为 c1
    expect(state.cardMap['c1#武圣']).toBeUndefined();
    expect(state.players[0].hand).toContain('c1');
    expect(state.players[0].hand).not.toContain('c1#武圣');
  });
});
