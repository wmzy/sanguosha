// tests/integration/create-game.test.ts
// e2e 覆盖:create(gameConfig) + bootstrap() 一次性产生完整可玩 state
// (主公选将 + 起始手牌 + 牌堆 + 第一回合)
import { describe, it, expect } from 'vitest';
import { create, bootstrap, resetForTest } from '../../src/engine/create-engine';
import type { GameConfig } from '../../src/engine/create-engine';

describe('create + bootstrap — 端到端开局', () => {
  it('create 同步返回骨架 state,bootstrap 异步跑完开局流程', async () => {
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
    // create 是同步的(返回骨架 state)
    const state = create(config);
    expect(state.players).toHaveLength(3);
    expect(state.zones.deck.length).toBe(0);  // 骨架没洗牌

    // bootstrap 异步跑完开局流程
    await bootstrap(state, config);

    // state 有 3 个玩家(对应 3 个角色;顺序由选将 atom 决定,不可假设)
    const assignedCharacters = new Set(state.players.map(p => p.character));
    expect(assignedCharacters).toEqual(new Set(['刘备', '曹操', '孙权']));

    // 主公已确定(由 抽身份 atom 决定)
    const lord = state.players.find(p => p.vars['身份'] === '主公');
    expect(lord).toBeDefined();
    expect(lord).toBe(state.players[0]);  // 主公是第一个玩家

    // 主公:发牌 5 + 摸牌阶段 2 = 7;其他玩家:发牌 4(还没到他们回合)
    for (const p of state.players) {
      const expected = p === lord ? 5 + 2 : 4;
      expect(p.hand.length).toBe(expected);
    }

    // 牌堆有牌(被摸了 13 + 2 张主公摸牌)
    expect(state.zones.deck.length).toBe(103 - (4 * 3 + 1) - 2);

    // 状态进入出牌阶段
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.turn.round).toBe(1);
    expect(state.phase).toBe('出牌');
  });
});
