// 奇谋(界魏延·限定技)测试:
//   "限定技,出牌阶段,你可以失去任意点体力并摸X张牌(X为你以此法失去的体力值),
//    然后你本回合计算与其他角色的距离-X且使用【杀】的限制次数+X。"
//
// 覆盖:
//   1. happy path:X=2 → 失2体力+摸2牌+距离-2(5人局 0↔2 距离 2→1)+出杀上限 1→3
//      + view 投影(turnUsage['杀/extra/奇谋']=2、distanceVars.attackMod=2)+限定技标记
//   2. 限定技:用过一次后再次发动被拒绝
//   3. 负面:非出牌阶段(弃牌)发动 → 拒绝
//   4. 负面:非自己回合发动 → 拒绝
//   5. 负面:选X回应非法值(0 / 超过当前体力 / 非数字)→ 拒绝,pending 保留
//   6. 选X超时(pass)→ 限定技不消耗(体力/手牌/标记无变化,可再次发动)
//   7. 回合结束:距离修正还原 + mark 移除 + 出杀上限回到 1 + turnUsage/attackMod 投影清空
//   8. X=当前体力 → 濒死无人救 → 死亡:不摸牌不发增益,但限定技已消耗
//
// 来源:界魏延缺少技能奇谋的补全任务。奇谋为独立技能,按 tests/skill-tests/<技能名>.test.ts
// 约定独立成文件;若未来新建界魏延武将级测试文件,本文件用例可归并过去。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState, suitColor } from '../../src/engine/types';
import type { GameState, PlayerState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import { slashMax } from '../../src/engine/rules/slash-quota';
import { effectiveDistance } from '../../src/engine/rules/distance';

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
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

/** 标准局:N 名玩家,界魏延在座次 0,当前回合。 */
function makeState(opts: {
  playerCount?: number;
  health?: number;
  phase?: GameState['phase'];
  currentPlayerIndex?: number;
} = {}): GameState {
  const n = opts.playerCount ?? 2;
  const players: PlayerState[] = [
    mkPlayer({
      index: 0,
      name: '界魏延',
      character: '界魏延',
      skills: ['奇谋'],
      health: opts.health ?? 4,
      maxHealth: opts.health ?? 4,
    }),
  ];
  for (let i = 1; i < n; i++) {
    players.push(mkPlayer({ index: i, name: `P${i + 1}` }));
  }
  return createGameState({
    players,
    cardMap: {},
    currentPlayerIndex: opts.currentPlayerIndex ?? 0,
    phase: opts.phase ?? '出牌',
    turn: { round: 1, phase: (opts.phase ?? '出牌') as GameState['turn']['phase'], vars: {} },
  });
}

describe('奇谋', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path:X=2 → 失血+摸牌+距离-2+出杀上限+2+view 投影 ───
  it('X=2:失去2体力、摸2牌,距离-2(5人局 0↔2 距离 2→1),出杀上限 1→3,view 投影正确', async () => {
    const state = makeState({ playerCount: 5 });
    await harness.setup(state);
    const WY = harness.player('界魏延');

    // 前置可证伪基线:5 人局 0↔2 座位距离 2;上限 1
    expect(effectiveDistance(state, 0, 2)).toBe(2);
    expect(slashMax(state, 0)).toBe(1);

    await WY.triggerAction('奇谋', 'use', {});
    WY.expectPending('请求回应');
    await WY.respond('奇谋', { option: '2' });

    expect(state.players[0].health).toBe(2); // 4 - 2
    expect(state.players[0].hand.length).toBe(2); // 摸 2
    expect(state.players[0].vars['奇谋/used']).toBe(true); // 限定技已消耗
    expect(state.players[0].vars['距离/进攻修正']).toBe(2);
    expect(effectiveDistance(state, 0, 2)).toBe(1); // 2 - 2 → 下限 1
    expect(slashMax(state, 0)).toBe(3); // 额定 1 + 额外 2
    expect(state.players[0].marks.some((m) => m.id === '奇谋/距离')).toBe(true);
    WY.expectView((v) => {
      const p = v.players.find((pl) => pl.index === 0)!;
      expect(p.turnUsage?.['杀/extra/奇谋']).toBe(2);
      expect(p.distanceVars?.attackMod).toBe(2);
    });
  });

  // ─── 2. 限定技:用过一次后再次发动被拒绝 ───
  it('限定技:用过一次后再次发动被拒绝', async () => {
    const state = makeState();
    await harness.setup(state);
    const WY = harness.player('界魏延');

    await WY.triggerAction('奇谋', 'use', {});
    await WY.respond('奇谋', { option: '1' });
    expect(state.players[0].health).toBe(3);

    await WY.expectRejected({ skillId: '奇谋', actionType: 'use', params: {} });
  });

  // ─── 3. 负面:非出牌阶段(弃牌)发动 → 拒绝 ───
  it('负面:非出牌阶段(弃牌)发动被拒绝', async () => {
    const state = makeState({ phase: '弃牌' });
    await harness.setup(state);
    const WY = harness.player('界魏延');

    await WY.expectRejected({ skillId: '奇谋', actionType: 'use', params: {} });
    expect(state.players[0].vars['奇谋/used']).toBeUndefined();
  });

  // ─── 4. 负面:非自己回合发动 → 拒绝 ───
  it('负面:非自己回合发动被拒绝', async () => {
    const state = makeState({ currentPlayerIndex: 1 });
    await harness.setup(state);
    const WY = harness.player('界魏延');

    await WY.expectRejected({ skillId: '奇谋', actionType: 'use', params: {} });
    expect(state.players[0].vars['奇谋/used']).toBeUndefined();
  });

  // ─── 5. 负面:选X回应非法值 → 拒绝,pending 保留,合法值仍可提交 ───
  it('负面:选X非法值(0 / 超过体力 / 非数字)被拒绝,pending 保留', async () => {
    const state = makeState();
    await harness.setup(state);
    const WY = harness.player('界魏延');

    await WY.triggerAction('奇谋', 'use', {});
    WY.expectPending('请求回应');
    await WY.expectRejected({ skillId: '奇谋', actionType: 'respond', params: { option: '0' } });
    await WY.expectRejected({ skillId: '奇谋', actionType: 'respond', params: { option: '5' } });
    await WY.expectRejected({ skillId: '奇谋', actionType: 'respond', params: { option: 'abc' } });

    // pending 仍在,合法值可用
    await WY.respond('奇谋', { option: '1' });
    expect(state.players[0].health).toBe(3);
  });

  // ─── 6. 选X超时(pass)→ 限定技不消耗 ───
  it('选X超时 → 限定技不消耗(无任何状态变化,可再次发动)', async () => {
    const state = makeState();
    await harness.setup(state);
    const WY = harness.player('界魏延');

    await WY.triggerAction('奇谋', 'use', {});
    WY.expectPending('请求回应');
    await WY.pass();

    expect(state.players[0].health).toBe(4);
    expect(state.players[0].hand.length).toBe(0);
    expect(state.players[0].vars['奇谋/used']).toBeUndefined();
    expect(state.players[0].vars['距离/进攻修正']).toBeUndefined();

    // 未消耗 → 可再次发动(若被拒绝则无 pending,expectPending 会抛错)
    await WY.triggerAction('奇谋', 'use', {});
    WY.expectPending('请求回应');
  });

  // ─── 7. 回合结束:增益全部还原 ───
  it('回合结束:距离修正还原、mark 移除、出杀上限回到 1、view 投影清空', async () => {
    const state = makeState();
    await harness.setup(state);
    const WY = harness.player('界魏延');

    await WY.triggerAction('奇谋', 'use', {});
    await WY.respond('奇谋', { option: '1' });
    expect(slashMax(state, 0)).toBe(2); // 1 + 1

    await applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(state.players[0].vars['距离/进攻修正']).toBeUndefined();
    expect(state.players[0].vars['奇谋/距离加成']).toBeUndefined();
    expect(state.players[0].marks.some((m) => m.id === '奇谋/距离')).toBe(false);
    expect(slashMax(state, 0)).toBe(1);
    expect(effectiveDistance(state, 0, 1)).toBe(1); // 2人局距离回到 1
    // 限定技标记是整局一次,不随回合清空
    expect(state.players[0].vars['奇谋/used']).toBe(true);
    WY.expectView((v) => {
      const p = v.players.find((pl) => pl.index === 0)!;
      expect(p.turnUsage?.['杀/extra/奇谋']).toBeUndefined();
      expect(p.distanceVars?.attackMod).toBeUndefined();
    });
  });

  // ─── 8. X=当前体力 → 濒死无人救 → 死亡:不摸牌不发增益,限定技已消耗 ───
  it('X=当前体力 → 濒死无人救 → 死亡,不摸牌无增益,限定技已消耗', async () => {
    // 3 人局(避免 2 人局死亡即游戏结束的合成流边界);全员无手牌 → 无桃可救
    const state = makeState({ playerCount: 3, health: 3 });
    await harness.setup(state);
    const WY = harness.player('界魏延');

    await WY.triggerAction('奇谋', 'use', {});
    await WY.respond('奇谋', { option: '3' });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(state.players[0].alive).toBe(false);
    expect(state.players[0].hand.length).toBe(0); // 未摸牌
    expect(state.players[0].vars['距离/进攻修正']).toBeUndefined(); // 无增益
    expect(state.players[0].marks.some((m) => m.id === '奇谋/距离')).toBe(false);
    expect(state.players[0].vars['奇谋/used']).toBe(true); // 限定技已消耗
  });
});
