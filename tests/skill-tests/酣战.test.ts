// 酣战(界太史慈·吴·一般技)行为测试,OL hero/463:
//   "当你拼点前,你可以令对方用随机手牌拼点。当你拼点后,你可以获得拼点牌中
//    点数最大的【杀】。"
//
// 太史慈拼点来源为【天义】(复用标版)。酣战挂钩天义的拼点流程。
//
// 覆盖:
//   1. 拼点前·令对方随机手牌拼点(确认)+ 拼点后·获杀(确认):
//      太史慈以杀K拼点,随机取目标一张闪2 → 太史慈赢 → 获回杀K
//   2. 拼点前·放弃随机 → 正常询问目标出拼点牌
//   3. 拼点后·放弃获杀 → 杀留在弃牌堆
//   4. 两张拼点牌无杀 → 不询问获杀
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 是否存在 requestType 为 rt 的 pending */
function hasPending(state: GameState, rt: string): boolean {
  for (const slot of state.pendingSlots.values()) {
    if ((slot.atom as { requestType?: string }).requestType === rt) return true;
  }
  return false;
}

describe('酣战', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 随机拼点 + 获杀 ────────────────────────────────
  it('拼点前令对方随机手牌拼点 + 拼点后获杀 → 太史慈赢并获回杀K', async () => {
    const tscPd = mkCard('pd0', '杀', '♠', 'K'); // 太史慈拼点牌(杀K)
    const p1a = mkCard('c2', '闪', '♥', '2'); // 目标手牌(非杀,点2)
    const p1b = mkCard('c3', '闪', '♣', '2'); // 目标手牌(非杀,点2)
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界太史慈',
            hand: ['pd0'],
            skills: ['天义', '酣战'],
          }),
          mkPlayer({ index: 1, name: '目标', hand: ['c2', 'c3'], skills: ['回合管理'] }),
        ],
        cardMap: { pd0: tscPd, c2: p1a, c3: p1b },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const TSC = harness.player('界太史慈');

    // 发动天义
    await TSC.triggerAction('天义', 'use', { cardId: 'pd0', target: 1 });
    await harness.waitForStable();
    // 酣战拦截:询问太史慈是否随机拼点(目标未被询问天义/拼点)
    expect(hasPending(harness.state, '酣战/随机拼点')).toBe(true);
    expect(hasPending(harness.state, '天义/拼点')).toBe(false);

    // 确认随机拼点
    await TSC.respond('酣战', { choice: true });
    await harness.waitForStable();
    // 拼点结算后,酣战询问获杀(拼点牌中含杀 pd0)
    expect(hasPending(harness.state, '酣战/获杀')).toBe(true);

    // 确认获杀
    await TSC.respond('酣战', { choice: true });
    await harness.waitForStable();

    // 太史慈 K > 2 → 赢
    expect(harness.state.turn.vars['天义/win']).toBe(0);
    expect(harness.state.turn.vars['天义/lost']).toBeUndefined();
    // 杀 pd0 被酣战取回太史慈手牌;目标的随机一张闪进弃牌堆
    expect(harness.state.players[0].hand).toContain('pd0');
    expect(harness.state.zones.discardPile).not.toContain('pd0');
    // 目标两张闪中被随机用掉一张,剩一张在手牌
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.zones.discardPile.some((id) => id === 'c2' || id === 'c3')).toBe(true);
  });

  // ─── 2. 放弃随机 → 正常询问目标出拼点牌 ─────────────────
  it('拼点前放弃随机 → 目标被询问出拼点牌(正常拼点)', async () => {
    const tscPd = mkCard('pd0', '杀', '♠', 'K');
    const p1a = mkCard('c2', '闪', '♥', '2');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界太史慈', hand: ['pd0'], skills: ['天义', '酣战'] }),
          mkPlayer({ index: 1, name: '目标', hand: ['c2'], skills: ['回合管理'] }),
        ],
        cardMap: { pd0: tscPd, c2: p1a },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const TSC = harness.player('界太史慈');
    const P1 = harness.player('目标');

    await TSC.triggerAction('天义', 'use', { cardId: 'pd0', target: 1 });
    await harness.waitForStable();
    expect(hasPending(harness.state, '酣战/随机拼点')).toBe(true);

    // 放弃随机
    await TSC.respond('酣战', { choice: false });
    await harness.waitForStable();
    // 正常询问目标出拼点牌
    expect(hasPending(harness.state, '天义/拼点')).toBe(true);
    await P1.respond('天义', { cardId: 'c2' });
    await harness.waitForStable();
    // 拼点牌含杀 pd0 → 询问获杀
    expect(hasPending(harness.state, '酣战/获杀')).toBe(true);
    await TSC.pass(); // 放弃获杀
    await harness.waitForStable();

    expect(harness.state.turn.vars['天义/win']).toBe(0); // K > 2 赢
  });

  // ─── 3. 放弃获杀 → 杀留在弃牌堆 ─────────────────────────
  it('拼点后放弃获杀 → 杀留在弃牌堆', async () => {
    const tscPd = mkCard('pd0', '杀', '♠', 'K');
    const p1a = mkCard('c2', '闪', '♥', '2');
    const p1b = mkCard('c3', '闪', '♣', '2');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界太史慈', hand: ['pd0'], skills: ['天义', '酣战'] }),
          mkPlayer({ index: 1, name: '目标', hand: ['c2', 'c3'], skills: ['回合管理'] }),
        ],
        cardMap: { pd0: tscPd, c2: p1a, c3: p1b },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const TSC = harness.player('界太史慈');

    await TSC.triggerAction('天义', 'use', { cardId: 'pd0', target: 1 });
    await harness.waitForStable();
    await TSC.respond('酣战', { choice: true }); // 随机拼点
    await harness.waitForStable();
    expect(hasPending(harness.state, '酣战/获杀')).toBe(true);

    // 放弃获杀
    await TSC.respond('酣战', { choice: false });
    await harness.waitForStable();

    // 杀 pd0 留在弃牌堆,不在太史慈手牌
    expect(harness.state.zones.discardPile).toContain('pd0');
    expect(harness.state.players[0].hand).not.toContain('pd0');
  });

  // ─── 4. 两张拼点牌无杀 → 不询问获杀 ─────────────────────
  it('两张拼点牌均非杀 → 拼点后不询问获杀', async () => {
    const tscPd = mkCard('pd0', '闪', '♠', 'K'); // 太史慈拼点牌(非杀)
    const p1a = mkCard('c2', '闪', '♥', '2');
    const p1b = mkCard('c3', '桃', '♣', '2');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界太史慈', hand: ['pd0'], skills: ['天义', '酣战'] }),
          mkPlayer({ index: 1, name: '目标', hand: ['c2', 'c3'], skills: ['回合管理'] }),
        ],
        cardMap: { pd0: tscPd, c2: p1a, c3: p1b },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const TSC = harness.player('界太史慈');

    await TSC.triggerAction('天义', 'use', { cardId: 'pd0', target: 1 });
    await harness.waitForStable();
    await TSC.respond('酣战', { choice: true }); // 随机拼点
    await harness.waitForStable();

    // 两张拼点牌均非杀 → 不询问获杀;天义直接结算完成
    expect(hasPending(harness.state, '酣战/获杀')).toBe(false);
    expect(harness.state.turn.vars['天义/win']).toBe(0); // K > 2 赢
    expect(harness.state.players[0].vars['天义/usedThisTurn']).toBe(true);
  });
});
