// tests/integration/create-game.test.ts
// e2e 覆盖:create(gameConfig) 一次性返回完整可玩 state(主公选将 + 起始手牌 + 牌堆 + 第一回合)
import { describe, it, expect } from 'vitest';
import { create } from '../../src/engine/create-engine';
import { resetForTest } from '../../src/engine/create-engine';
import type { GameConfig } from '../../src/engine/create-engine';

describe('create(gameConfig) — 端到端开局', () => {
  it('一次调用产生完整可玩 state:主公选将完成 + 4 张起始手牌', async () => {
    resetForTest();
    const config: GameConfig = {
      characters: [
        { name: '刘备', skills: ['仁德'] },
        { name: '曹操', skills: ['护甲'] },
        { name: '孙权', skills: ['制衡'] },
      ],
      playerCount: 3,
      seed: 42,
      gameId: 'test-create',
    };
    const state = await create(config);

    // state 有 3 个玩家(对应 3 个角色)
    expect(state.players).toHaveLength(3);
    expect(state.players.map(p => p.character).sort()).toEqual(['刘备', '曹操', '孙权']);

    // 主公已确定(由 抽身份 atom 决定)
    const lord = state.players.find(p => p.vars['身份'] === '主公');
    expect(lord).toBeDefined();
    expect(lord).toBe(state.players[0]);  // 主公是第一个玩家

    // 每个玩家有 4 张起始手牌(主公 5 张 lordBonus)
    for (const p of state.players) {
      const expected = p === lord ? 5 : 4;
      expect(p.hand.length).toBe(expected);
    }

    // 牌堆有牌(被摸了 13 张,108 - 13 = 95)
    expect(state.zones.deck.length).toBe(108 - (4 * 3 + 1));  // 4 张 × 3 人 + 1 张主公奖励

    // 状态进入第一个回合(主公 回合开始 / 阶段开始 已 apply)
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.turn.round).toBe(1);
  });
});
