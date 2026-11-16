// tests/engine/distance-parity.test.ts
// 同构契约:rules/distance.ts(引擎侧,基于 GameState)与 rules/viewDistance.ts
// (view 侧,基于 GameView.distanceVars/turnUsage 投影)必须对同一 state 给出完全一致的
// 距离/攻击范围判定:
//   - 环形座位距离(跳过死亡玩家;按 p.index 定位座次);
//   - 修饰顺序:attackMod(进攻马/马术)先减 → defenseMod(防御马)后加 → Math.max(1, dist);
//   - 通用距离豁免视为 1;攻击范围豁免只放行【杀】且不缩短锦囊距离(不对称两侧同构);
//   - 出杀范围默认 1(徒手),vars['距离/出杀范围'] 覆盖。
//
// 与既有测试互补:
//   - tests/engine/view-distance-sync.test.ts —— 静态扫描:豁免登记表与 register* 调用点同步;
//   - tests/integration/距离放宽视图投影.test.ts —— 真实技能触发后的端到端投影。
// 本文件在单元层钉死「同一 state → 引擎侧与 view 侧逐座次对一致」:任一侧的计算管线
// (定位约定/修饰顺序/下限/豁免短路)单独改动都会在此红。
import { describe, expect, it } from 'vitest';
import { buildView } from '../../src/engine/index';
import {
  effectiveDistance,
  inAttackRange,
  registerAttackRangeExemptor,
  registerDistanceExemptor,
} from '../../src/engine/rules/distance';
import { viewCanAttack, viewEffectiveDistance } from '../../src/engine/rules/viewDistance';
import {
  DISTANCE_ATTACK_MOD_KEY,
  DISTANCE_ATTACK_RANGE_KEY,
  DISTANCE_DEFENSE_MOD_KEY,
  GONGQI_ACTIVE_VIEW_KEY,
  JUEYAN_MOUNT_VIEW_KEY,
  viewMirrorKey,
} from '../../src/engine/rules/vars-keys';
import { createGameState } from '../../src/engine/types';
import type { GameState, PlayerState } from '../../src/engine/types';

function mkPlayer(index: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    index,
    name: `P${index}`,
    character: `P${index}`,
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [],
    equipment: {},
    skills: ['回合管理'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    ...overrides,
  };
}

function mkState(players: PlayerState[]): GameState {
  return createGameState({
    players,
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

/** 全量 parity 断言:同一 state 的引擎侧与 view 侧,所有座次对的距离/攻击范围一致。
 *  同时锁定行为等价前提:view.players 按座次有序(players[i].index === i)——
 *  viewDistance 的 playerBySeat(按 p.index 查找)与数组下标据此等价,
 *  投影一旦改为乱序,该断言先于 parity 失败,指向真正的漂移源。 */
function expectParityAllPairs(state: GameState): void {
  const view = buildView(state, 0);
  expect(view.players.map((p) => p.index)).toEqual(view.players.map((_p, i) => i));

  for (let from = 0; from < state.players.length; from++) {
    for (let to = 0; to < state.players.length; to++) {
      expect(
        viewEffectiveDistance(view.players, from, to),
        `viewEffectiveDistance(${from}, ${to}) 应与引擎 effectiveDistance 一致`,
      ).toBe(effectiveDistance(state, from, to));
      expect(
        viewCanAttack(view.players, from, to),
        `viewCanAttack(${from}, ${to}) 应与引擎 inAttackRange 一致`,
      ).toBe(inAttackRange(state, from, to));
    }
  }
}

describe('rules/distance 与 rules/viewDistance 同构', () => {
  it('基础座位距离 + 徒手出杀范围默认 1', () => {
    const state = mkState([mkPlayer(0), mkPlayer(1), mkPlayer(2), mkPlayer(3)]);
    expect(effectiveDistance(state, 0, 2)).toBe(2);
    expect(inAttackRange(state, 0, 2)).toBe(false);
    expectParityAllPairs(state);
  });

  it('进攻马(attackMod 先减):只缩短自己看别人的距离,方向性生效', () => {
    const state = mkState([mkPlayer(0), mkPlayer(1), mkPlayer(2), mkPlayer(3)]);
    state.players[0].vars[DISTANCE_ATTACK_MOD_KEY] = 1;
    expect(effectiveDistance(state, 0, 2)).toBe(1); // 2 - 1
    expect(effectiveDistance(state, 2, 0)).toBe(2); // 反方向不吃 from 的进攻修正
    expectParityAllPairs(state);
  });

  it('防御马(defenseMod 后加):只增加别人到自己的距离', () => {
    const state = mkState([mkPlayer(0), mkPlayer(1), mkPlayer(2), mkPlayer(3)]);
    state.players[2].vars[DISTANCE_DEFENSE_MOD_KEY] = 1;
    expect(effectiveDistance(state, 0, 2)).toBe(3); // 2 + 1
    expect(effectiveDistance(state, 2, 0)).toBe(2); // 反方向不吃 to 的防御修正
    expectParityAllPairs(state);
  });

  it('修饰顺序与下限:attackMod 减 → defenseMod 加 → max(1, dist)', () => {
    const state = mkState([mkPlayer(0), mkPlayer(1), mkPlayer(2), mkPlayer(3)]);
    // 2 - 3 + 1 = 0 → 下限 1:下限必须最后施加(先 clamp 再加防御会得 2)
    state.players[0].vars[DISTANCE_ATTACK_MOD_KEY] = 3;
    state.players[2].vars[DISTANCE_DEFENSE_MOD_KEY] = 1;
    expect(effectiveDistance(state, 0, 2)).toBe(1);
    // 邻座 1 - 3 + 0 = -2 → 下限 1
    expect(effectiveDistance(state, 0, 1)).toBe(1);
    expectParityAllPairs(state);
  });

  it('武器攻击范围:vars[距离/出杀范围] 覆盖徒手默认 1', () => {
    const state = mkState([mkPlayer(0), mkPlayer(1), mkPlayer(2), mkPlayer(3)]);
    state.players[0].vars[DISTANCE_ATTACK_RANGE_KEY] = 3;
    expect(inAttackRange(state, 0, 2)).toBe(true); // 距离 2 ≤ 范围 3
    expect(inAttackRange(state, 1, 3)).toBe(false); // 其他人仍徒手
    expectParityAllPairs(state);
  });

  it('死亡玩家跳过环形计数,且不参与杀的可及性判定', () => {
    const state = mkState([mkPlayer(0), mkPlayer(1), mkPlayer(2), mkPlayer(3)]);
    // P1 死亡:0→2 的存活环为 [0,2,3],座位距离 1
    state.players[1].alive = false;
    state.players[1].vars[DISTANCE_DEFENSE_MOD_KEY] = 5;
    state.players[1].vars[DISTANCE_ATTACK_RANGE_KEY] = 9;
    expect(effectiveDistance(state, 0, 2)).toBe(1);
    expect(inAttackRange(state, 0, 2)).toBe(true);
    expectParityAllPairs(state); // 含指向死亡座次的对:两侧同判 Infinity/不可及
  });

  it('通用距离豁免:引擎 registerDistanceExemptor 与 view 登记表(决堰键)同时视为 1', () => {
    const state = mkState([mkPlayer(0), mkPlayer(1), mkPlayer(2), mkPlayer(3)]);
    // 引擎侧:注册 from=0 恒真豁免器(镜像 决堰 坐骑栏效果的注册形态)
    registerDistanceExemptor(state, 0, (_st, from) => from === 0);
    // view 侧:回合用量镜像 __view/0/<决堰坐骑键>(projectPlayer 据此投影 turnUsage)
    state.turn.vars[viewMirrorKey(0, JUEYAN_MOUNT_VIEW_KEY)] = 1;

    expect(effectiveDistance(state, 0, 2)).toBe(1); // 豁免:距离 2 视为 1
    expect(effectiveDistance(state, 1, 3)).toBe(2); // 非豁免方不受影响
    expectParityAllPairs(state);
  });

  it('攻击范围豁免:只放行杀,不缩短通用距离(界弓骑键,不对称两侧同构)', () => {
    const state = mkState([mkPlayer(0), mkPlayer(1), mkPlayer(2), mkPlayer(3)]);
    registerAttackRangeExemptor(state, 0, (_st, from) => from === 0);
    state.turn.vars[viewMirrorKey(0, GONGQI_ACTIVE_VIEW_KEY)] = 1;

    expect(effectiveDistance(state, 0, 2)).toBe(2); // 攻击范围豁免不得缩短锦囊距离
    expect(inAttackRange(state, 0, 2)).toBe(true); // 但【杀】可及(2 > 徒手范围 1)
    expectParityAllPairs(state);
  });

  it('全对扫描:双马 + 武器 + 死亡玩家共存时逐对一致', () => {
    const state = mkState([
      mkPlayer(0, { vars: { [DISTANCE_ATTACK_MOD_KEY]: 1 } }),
      mkPlayer(1, { vars: { [DISTANCE_ATTACK_RANGE_KEY]: 4 } }),
      mkPlayer(2), // 本用例内置为死亡(存活环 [0,1,3,4])
      mkPlayer(3, { vars: { [DISTANCE_ATTACK_MOD_KEY]: 2 } }),
      mkPlayer(4, { vars: { [DISTANCE_DEFENSE_MOD_KEY]: 1 } }),
    ]);
    state.players[2].alive = false;
    // 存活环 [0,1,3,4]:0↔3 环距 2、1↔4 环距 2;修正按方向不同 → 逐对覆盖顺序/下限
    expect(effectiveDistance(state, 0, 3)).toBe(1); // 2 - 1(P0 进攻马)
    expect(effectiveDistance(state, 3, 0)).toBe(1); // 2 - 2(P3 进攻马)→ 下限 1
    expect(effectiveDistance(state, 1, 4)).toBe(3); // 2 + 1(防御马)
    expect(effectiveDistance(state, 4, 1)).toBe(2); // P4 无进攻修正
    expectParityAllPairs(state);
  });
});
