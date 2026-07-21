// 界陷阵(界高顺·群·主动技)测试,OL hero/604 官方逐字:
//   "出牌阶段限一次，你可以与一名角色拼点：若你赢，你本回合对其使用牌无距离和次数限制
//    且无视其防具，你使用【杀】或普通锦囊牌能多指定其为目标；若你没赢，你本回合不能
//    对其使用【杀】且你的【杀】不计入手牌上限。"
//
// 验证:
//   1. 拼点赢 → turn.vars['陷阵/winTarget']=target;两张拼点牌进弃牌堆;限一次标记
//   2. 拼点赢 → 对 winTarget 出杀无距离限制(3 人座次,超距放行)
//   3. 拼点赢 → 对 winTarget 出杀无次数限制(连出 2 张以上)
//   4. 拼点赢 → 对 winTarget 出杀无视防具(仁王盾黑杀仍命中)
//   5. 拼点没赢 → turn.vars['陷阵/lostTarget']=target;对 target 出杀被 cancel(不伤害)
//   6. 拼点没赢 → 杀不计入手牌上限(handLimit = 体力 + 杀牌数)
//   7. 平 → 算没赢,同 5/6
//   8. 每回合限一次:第二次被拒
//   9. 不是自己回合 → 拒绝;不能与自己拼点;目标无手牌 → 拒绝
//  10. 回合结束 → turn.vars 自动清空
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { slashMax, slashUsed } from '../../src/engine/slash-quota';
import { handLimit } from '../../src/engine/hand-limit';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: PlayerState['equipment'];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界高顺',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界陷阵', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 拼点赢 → winTarget 置位 + 牌进弃牌堆 + 限一次 ──────────────────
  it('拼点赢 → turn.vars[陷阵/winTarget] 置位,两张拼点牌进弃牌堆,限一次标记', async () => {
    const ownerHigh = makeCard('c1', '杀', '♠', 'K');
    const targetLow = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['界陷阵'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerHigh, c2: targetLow },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界陷阵', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界陷阵', { cardId: 'c2' });
    await waitForStable(harness.state);

    expect(harness.state.turn.vars['陷阵/winTarget']).toBe(1);
    expect(harness.state.turn.vars['陷阵/lostTarget']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
    expect(harness.state.players[0].vars['界陷阵/usedThisTurn']).toBe(true);
  });

  // ─── 2. 拼点赢 → 对 winTarget 出杀无距离限制 ──────────────────
  it('拼点赢 → 对 winTarget 出杀无距离限制(3 人座次超距放行)', async () => {
    // 3 人座次,P0 徒手攻击范围=1,P2(距离 2)超距;winTarget=P2 后应可出杀
    const pdWin = makeCard('c1', '杀', '♠', 'K');
    const pdLow = makeCard('c2', '闪', '♥', '2');
    const slash = makeCard('s1', '杀', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 's1'],
          skills: ['界陷阵', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: pdWin, c2: pdLow, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');

    // 拼点赢 P2
    await P0.triggerAction('界陷阵', 'use', { cardId: 'c1', target: 2 });
    await waitForStable(harness.state);
    await P2.respond('界陷阵', { cardId: 'c2' });
    await waitForStable(harness.state);
    expect(harness.state.turn.vars['陷阵/winTarget']).toBe(2);

    // 对 P2(超距)出杀:应放行(无距离限制)
    await P0.useCardAndTarget('杀', 's1', [2]);
    await waitForStable(harness.state);
    await P2.pass(); // 不出闪
    await waitForStable(harness.state);

    // P2 受伤 → 杀成功(证明无距离限制生效)
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 3. 拼点赢 → 对 winTarget 出杀无次数限制 ──────────────────
  it('拼点赢 → slashMax=∞,可连出多张杀', async () => {
    const pdWin = makeCard('c1', '杀', '♠', 'K');
    const pdLow = makeCard('c2', '闪', '♥', '2');
    const s1 = makeCard('s1', '杀', '♣', '5');
    const s2 = makeCard('s2', '杀', '♠', '6');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 's1', 's2'],
          skills: ['界陷阵', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: pdWin, c2: pdLow, s1, s2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界陷阵', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界陷阵', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 拼点赢 → slashMax=∞
    expect(slashMax(harness.state, 0)).toBe(Infinity);

    // 连出两张杀
    await P0.useCardAndTarget('杀', 's1', [1]);
    await waitForStable(harness.state);
    await P1.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[1].health).toBe(3);
    expect(slashUsed(harness.state)).toBe(1);

    await P0.useCardAndTarget('杀', 's2', [1]);
    await waitForStable(harness.state);
    await P1.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[1].health).toBe(2);
    expect(slashUsed(harness.state)).toBe(2);
  });

  // ─── 4. 拼点赢 → 对 winTarget 出杀无视防具(仁王盾黑杀命中) ──────────
  it('拼点赢 → 黑杀命中装备仁王盾的 winTarget(无视防具)', async () => {
    const pdWin = makeCard('c1', '杀', '♠', 'K');
    const pdLow = makeCard('c2', '闪', '♥', '2');
    const blackSlash = makeCard('s1', '杀', '♠', '5'); // 黑杀,正常被仁王盾无效
    const renwang = makeCard('rw1', '仁王盾', '♠', '2', '装备牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 's1'],
          skills: ['界陷阵', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理', '仁王盾'],
          equipment: { 防具: 'rw1' },
        }),
      ],
      cardMap: { c1: pdWin, c2: pdLow, s1: blackSlash, rw1: renwang },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 拼点赢 P1
    await P0.triggerAction('界陷阵', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界陷阵', { cardId: 'c2' });
    await waitForStable(harness.state);
    expect(harness.state.turn.vars['陷阵/winTarget']).toBe(1);

    // 出黑杀打 P1(仁王盾):正常应无效,陷阵赢后无视防具 → 命中
    await P0.useCardAndTarget('杀', 's1', [1]);
    await waitForStable(harness.state);
    await P1.pass(); // 不出闪
    await waitForStable(harness.state);
    // 仁王盾被临时卸载 → 黑杀不被 cancel → 直接命中
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 5. 拼点没赢 → lostTarget 置位 + 对 target 出杀被 cancel ──────────
  it('拼点没赢 → 对 lostTarget 出杀跳过结算(不伤害)', async () => {
    const ownerLow = makeCard('c1', '杀', '♠', '2');
    const targetHigh = makeCard('c2', '闪', '♥', 'K');
    const slash = makeCard('s1', '杀', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 's1'],
          skills: ['界陷阵', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerLow, c2: targetHigh, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界陷阵', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界陷阵', { cardId: 'c2' });
    await waitForStable(harness.state);

    expect(harness.state.turn.vars['陷阵/winTarget']).toBeUndefined();
    expect(harness.state.turn.vars['陷阵/lostTarget']).toBe(1);

    // 对 lostTarget(P1)出杀:成为目标被 cancel → 不伤害
    await P0.useCardAndTarget('杀', 's1', [1]);
    await waitForStable(harness.state);
    expect(harness.state.players[1].health).toBe(4); // 未受伤
    // 杀牌仍被消耗(进弃牌堆)
    expect(harness.state.zones.discardPile).toContain('s1');
  });

  // ─── 6. 拼点没赢 → 杀不计入手牌上限 ──────────────────
  it('拼点没赢 → handLimit = 体力 + 手牌中杀牌数', async () => {
    const ownerLow = makeCard('c1', '杀', '♠', '2');
    const targetHigh = makeCard('c2', '闪', '♥', 'K');
    const s1 = makeCard('s1', '杀', '♣', '5');
    const s2 = makeCard('s2', '杀', '♠', '6');
    const s3 = makeCard('s3', '杀', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 's1', 's2', 's3'],
          skills: ['界陷阵'],
          health: 2,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerLow, c2: targetHigh, s1, s2, s3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界陷阵', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界陷阵', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 没赢 → 杀不计入手牌上限
    // P0 体力 2,手牌 3 张杀(s1/s2/s3) → handLimit = 2 + 3 = 5
    expect(harness.state.turn.vars['陷阵/lostTarget']).toBe(1);
    expect(handLimit(harness.state, 0)).toBe(5);
  });

  // ─── 7. 平点 → 算没赢 ──────────────────
  it('拼点平 → 算没赢,lostTarget 置位', async () => {
    const ownerK = makeCard('c1', '杀', '♠', 'K');
    const targetK = makeCard('c2', '闪', '♥', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['界陷阵'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerK, c2: targetK },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界陷阵', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界陷阵', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 平点(相等)→ 算没赢
    expect(harness.state.turn.vars['陷阵/winTarget']).toBeUndefined();
    expect(harness.state.turn.vars['陷阵/lostTarget']).toBe(1);
  });

  // ─── 8. 每回合限一次 ──────────────────
  it('每回合限一次:第二次被拒', async () => {
    const ownerHigh = makeCard('c1', '杀', '♠', 'K');
    const targetLow = makeCard('c2', '闪', '♥', '2');
    const secondCard = makeCard('c3', '杀', '♣', '8');
    const secondTarget = makeCard('c4', '闪', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c3'],
          skills: ['界陷阵'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2', 'c4'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerHigh, c2: targetLow, c3: secondCard, c4: secondTarget },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 第一次发动
    await P0.triggerAction('界陷阵', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界陷阵', { cardId: 'c2' });
    await waitForStable(harness.state);
    expect(harness.state.players[0].vars['界陷阵/usedThisTurn']).toBe(true);

    // 第二次发动:被拒
    await P0.expectRejected({
      skillId: '界陷阵',
      actionType: 'use',
      params: { cardId: 'c3', target: 1 },
    });
  });

  // ─── 9. 不是自己回合 / 自拼 / 目标无手牌 ──────────────────
  it('不是自己回合 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['界陷阵'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界陷阵',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  it('不能与自己拼点', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界陷阵'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界陷阵',
      actionType: 'use',
      params: { cardId: 'c1', target: 0 }, // 自拼
    });
  });

  it('目标无手牌 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['界陷阵'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }), // 无手牌
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界陷阵',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  // ─── 10. 回合结束 → turn.vars 自动清空 ──────────────────
  it('回合结束 → 陷阵/winTarget 与 lostTarget 自动清空', async () => {
    const ownerHigh = makeCard('c1', '杀', '♠', 'K');
    const targetLow = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['界陷阵'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerHigh, c2: targetLow },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: {
        round: 1,
        phase: '出牌',
        vars: { '陷阵/winTarget': 1, '陷阵/lostTarget': 2 },
      },
    });
    await harness.setup(state);

    // 触发回合结束 atom → turn.vars 自动清空
    void harness.state.atomHistory;
    const { applyAtom } = await import('../../src/engine/create-engine');
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await waitForStable(harness.state);

    expect(harness.state.turn.vars['陷阵/winTarget']).toBeUndefined();
    expect(harness.state.turn.vars['陷阵/lostTarget']).toBeUndefined();
  });
});
