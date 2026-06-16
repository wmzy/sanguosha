// tests/integration/identity-game.test.ts
// P2 验证:4 人身份局端到端。
// 验证:开局(身份/选将/发牌) → 回合流转 → 出杀 → 濒死求桃 → 游戏结束判定
import { describe, it, expect, beforeEach } from 'vitest';
import {
  create,
  bootstrap,
  dispatch,
  fireTimeout,
  resetForTest,
  checkGameOver,
  registerSkillsFromState,
  type GameConfig,
} from '../../src/engine/create-engine';
import { fireTimeoutAndWait,  dispatchAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { GameState, ClientMessage, Json, Card } from '../../src/engine/types';

function buildConfig(playerCount: number): GameConfig {
  return {
    characters: [
      { name: '刘备', skills: ['仁德', '激将'] },
      { name: '曹操', skills: ['护甲'] },
      { name: '孙权', skills: ['制衡'] },
      { name: '郭嘉', skills: ['遗计'] },
    ].slice(0, playerCount),
    playerCount,
    seed: 42,
    gameId: 'identity-e2e',
  };
}

describe('身份局端到端', () => {
  let state: GameState;

  beforeEach(async () => {
    resetForTest();
    state = create(buildConfig(4));
    await bootstrap(state, config);
  });

  const config = buildConfig(4);

  it('开局:4 人身份分配,主公亮明,每人有手牌', () => {
    expect(state.players).toHaveLength(4);
    // 主公存在且亮明
    const lord = state.players.find(p => p.identity === '主公' || p.vars['身份'] === '主公');
    expect(lord).toBeDefined();
    // 每人有手牌(主公 5,其他人 4)
    for (const p of state.players) {
      expect(p.hand.length).toBeGreaterThanOrEqual(4);
    }
    // 牌堆有剩余
    expect(state.zones.deck.length).toBeGreaterThan(0);
    // 第一回合,主公(0 号位)行动
    expect(state.turn.round).toBe(1);
    expect(state.currentPlayerIndex).toBe(0);
  });

  it('回合流转:P0 出杀 → P1 受伤 → 濒死求桃(无人救)→ 死亡', async () => {
    // 构造:P0 手牌有杀,P1 血量设为 1(一次杀就濒死)
    const lord = state.players[0];
    // 给 P0 一张杀
    const killCard: Card = { id: 'kill-1', name: '杀', suit: '♠', rank: '7', type: '基本牌' };
    state.cardMap['kill-1'] = killCard;
    lord.hand.push('kill-1');
    // P1 血量设 1
    state.players[1].health = 1;
    state.players[1].maxHealth = 1;

    // P0 对 P1 出杀
    await dispatchAndWait(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: 'kill-1', targets: [1] }, baseSeq: 0,
    });
    // 进入 询问闪 pending → P1 不闪(超时)
    expect(state.pendingSlot).toBeDefined();
    await fireTimeoutAndWait(state);

    // 询问闪 resolve 后,杀.execute 造成伤害(1点)→ P1 血量 0 → 濒死
    // 濒死流程 runDyingFlow:从 P1 开始依次问求桃,每人一个 pending
    // 循环 fireTimeout 直到所有求桃轮次结束
    let safety = 20;
    while (state.pendingSlot && safety-- > 0) {
      const atom = state.pendingSlot.atom as Record<string, unknown>;
      if (atom.requestType === '求桃' || atom.type === '请求回应') {
        await fireTimeoutAndWait(state);
      } else {
        break;
      }
    }

    // P1 死亡(无人救)
    expect(state.players[1].alive).toBe(false);
    expect(state.players[1].health).toBe(0);
    // P1 手牌进弃牌堆
    expect(state.players[1].hand).toHaveLength(0);
  });

  it('游戏结束:主公死亡 → 游戏结束', () => {
    // 主公设为死亡(其他 3 人存活)
    const lord = state.players[0];
    lord.health = 0;
    lord.alive = false;
    const result = checkGameOver(state);
    expect(result.gameOver).toBe(true);
  });

  it('游戏结束:只剩 1 人存活 → 游戏结束', () => {
    // 只留 P0 存活
    state.players[1].alive = false;
    state.players[2].alive = false;
    state.players[3].alive = false;
    const result = checkGameOver(state);
    expect(result.gameOver).toBe(true);
    expect(result.winner).toBe(0);
  });
});
