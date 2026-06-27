// 验证 harness 改进:确认引擎异常 + applyView 异常不再被静默吞掉。
// 这是回归测试:如果未来有人撤销了 harness 的防护,此文件会立即失败。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SkillTestHarness,
  dispatchAndWait,
  fireTimeoutAndWait,
  assertNoEngineErrors,
} from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { getAtomDef, registerAtom } from '../../src/engine/atom';
import type { Atom, Card, GameState, GameView, ViewEvent } from '../../src/engine/types';
import { dispatch as engineDispatch } from '../../src/engine/create-engine';

function build(): GameState {
  const slash: Card = { id: 's0', name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true,
        hand: ['s0'], equipment: {}, skills: ['杀'], tags: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '反', health: 4, maxHealth: 4, alive: true,
        hand: [], equipment: {}, skills: [], tags: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: { s0: slash },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('harness 改进:引擎异常不再静默吞掉', () => {
  it('onError 收集器在 setup 时自动注入', async () => {
    const harness = new SkillTestHarness();
    await harness.setup(build());
    // state.onError 已被 harness 接管
    expect(harness.state.onError).toBeDefined();
    // 未发生异常时 assertNoEngineErrors 不抛错
    expect(() => assertNoEngineErrors(harness.state)).not.toThrow();
  });

  it('注入模拟异常 → assertNoEngineErrors 抛错', async () => {
    const harness = new SkillTestHarness();
    await harness.setup(build());
    // 模拟引擎 fire-and-forget execute 抛错
    harness.state.onError!(new Error('模拟引擎 bug:execute 内部状态不一致'));
    // 应抛出聚合错误
    expect(() => assertNoEngineErrors(harness.state)).toThrow(/模拟引擎 bug/);
  });

  it('dispatchAndWait 路径:注入异常后立即暴露(不等超时)', async () => {
    const state = build();
    // dispatchAndWait 会通过 waitForStable 注入收集器
    // 先手动触发一个异常场景:用一个会抛错的 dispatch
    const harness = new SkillTestHarness();
    await harness.setup(state);
    // 直接调用 onError 模拟 execute 抛错
    state.onError!(new Error('execute fire-and-forget bug'));
    // 下次 waitForStable → assertNoEngineErrors 会捕获
    await expect(harness.waitForStable()).rejects.toThrow(/execute fire-and-forget bug/);
  });

  it('processAllEvents 检查引擎异常', async () => {
    const harness = new SkillTestHarness();
    await harness.setup(build());
    const P1 = harness.player('P1');
    // 正常操作
    await P1.useCardAndTarget('杀', 's0', [1]);
    // 注入异常
    harness.state.onError!(new Error('延迟暴露的 bug'));
    // processAllEvents 应该捕获
    expect(() => harness.processAllEvents()).toThrow(/延迟暴露的 bug/);
  });

  it('applyView 错误不再静默吞:processAllEvents 会抛出', async () => {
    const harness = new SkillTestHarness();
    await harness.setup(build());
    const P1 = harness.player('P1');
    // 正常出杀建立基线
    await P1.useCardAndTarget('杀', 's0', [1]);

    // 注册一个 throw applyView 的假 atom,然后手动推一个对应事件
    const FAKE_TYPE = '__test_applyview_throws';
    registerAtom({
      type: FAKE_TYPE,
      validate: () => null,
      apply: () => {},
      toViewEvents: () => ({ ownerViews: new Map(), othersView: { atomType: FAKE_TYPE } as unknown as ViewEvent }),
      applyView: () => { throw new Error('applyView 故意抛错'); },
    });

    // 手动推一个 atomHistory 条目(模拟引擎 apply 了一个 atom 但 applyView 坏了)
    harness.state.seq += 1;
    harness.state.atomHistory.push({
      kind: 'atom',
      seq: harness.state.seq,
      timestamp: 0,
      atom: { type: FAKE_TYPE } as unknown as Atom,
      viewEvents: { ownerViews: new Map(), othersView: { atomType: FAKE_TYPE } as unknown as ViewEvent },
    });

    // processAllEvents 应该抛出 applyView 错误(同时匹配两个模式)
    expect(() => harness.processAllEvents()).toThrow(/applyView 抛错[\S\s]*applyView 故意抛错/);
  });
});
