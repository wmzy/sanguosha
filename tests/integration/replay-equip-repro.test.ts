// @vitest-environment jsdom
// 临时复现测试:验证回放过程中装备状态是否随 step 正确变化。
// 用户报告:重播时角色卡牌装备显示的总是游戏结束时的状态,不是当时的。
//
// 复现策略:
//   1. P0 装备诸葛连弩
//   2. P0 出杀打 P1
//   3. 全程录制
//   4. 验证回放每个 step 的 equipment 状态
//
// 归并建议:确认 bug 后,合并到 replay-consistency.test.ts(若 bug 在录制/回放引擎)
//   或 playercard-equip-distribute.test.tsx(若 bug 在 UI 渲染)。
import { describe, it, expect } from 'vitest';
import { dispatchAndWait, fireTimeoutAndWait, SkillTestHarness } from '../engine-harness';
import { registerSkillsFromState } from '../../src/engine/create-engine';
import { ReplayRecorder } from '../../src/client/replay/recorder';
import { getViewAt } from '../../src/client/replay/replayEngine';
import { buildView } from '../../src/engine/create-engine';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import '../../src/engine/atoms';
import '../../src/engine/skills';

function makePlayer(index: number, name: string, hand: string[], skills: string[]) {
  return {
    index,
    name,
    character: name,
    health: 4,
    maxHealth: 4,
    alive: true,
    hand,
    equipment: {} as Record<string, string>,
    skills,
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('回放装备状态复现', () => {
  it('P0 装备诸葛连弩 → 出杀:回放各 step 的 equipment 应正确变化', async () => {
    const weapon: Card = {
      id: 'wp-zg',
      name: '诸葛连弩',
      suit: '♣',
      color: '黑',
      rank: 'A',
      type: '装备牌',
      subtype: '武器',
      range: 1,
    };
    const slash: Card = {
      id: 'k1',
      name: '杀',
      suit: '♠',
      color: '黑',
      rank: '7',
      type: '基本牌',
    };

    const state: GameState = createGameState({
      players: [
        makePlayer(0, 'P0', [weapon.id, slash.id], ['杀', '装备通用']),
        makePlayer(1, 'P1', [], ['闪']),
      ],
      cardMap: { [weapon.id]: weapon, [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      rngSeed: 42,
      meta: { gameId: 'test-replay-equip', createdAt: Date.now() },
    });

    const h = new SkillTestHarness();
    await h.setup(state);
    await registerSkillsFromState(state);

    const recorder = new ReplayRecorder();
    const viewers = [0, 1];

    // 捕获 initialView(空 events)
    for (const v of viewers) {
      recorder.record(v, buildView(h.state, v), []);
    }

    // 装备诸葛连弩
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: weapon.id },
      baseSeq: state.seq,
    });
    for (const v of viewers) {
      const session = h.player(v);
      const events = session.processEvents();
      recorder.record(v, session.processedView, events);
    }

    // 出杀打 P1
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    for (const v of viewers) {
      const session = h.player(v);
      const events = session.processEvents();
      recorder.record(v, session.processedView, events);
    }

    // P1 超时不出闪
    await fireTimeoutAndWait(state);
    for (const v of viewers) {
      const session = h.player(v);
      const events = session.processEvents();
      recorder.record(v, session.processedView, events);
    }

    const file = recorder.finalize({
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['P0', 'P1'],
    });

    // 导出录像供浏览器复现
    const fs = await import('node:fs');
    fs.writeFileSync('/tmp/sgs-replay-equip.json', JSON.stringify(file, null, 2));
    const total = file.seats[0].events.length;
    console.log('P0 总步数:', total);
    console.log('P0 initialView equipment:', file.seats[0].initialView.players[0].equipment);
    console.log(
      'P0 final processedView equipment:',
      h.player(0).processedView.players[0].equipment,
    );

    // 打印每一步的 equipment 状态
    for (let step = 0; step <= total; step++) {
      const v = getViewAt(file, 0, step)!;
      const eq = v.players[0].equipment;
      console.log(
        `step=${step} event.type=${file.seats[0].events[step - 1]?.event.type ?? '(initial)'}:`,
        `武器=${eq['武器'] ?? '(空)'}`,
      );
    }

    // step=0:initialView,P0 无武器
    expect(getViewAt(file, 0, 0)!.players[0].equipment['武器']).toBeUndefined();

    // 找到装备事件的位置,验证之后武器存在
    const equipStep = file.seats[0].events.findIndex(
      (e) => e.event.type === '装备',
    );
    expect(equipStep).toBeGreaterThanOrEqual(0);
    console.log('装备事件位于 step =', equipStep + 1, '(1-indexed)');

    // 装备事件应用后:武器 = wp-zg
    const afterEquip = getViewAt(file, 0, equipStep + 1)!;
    expect(afterEquip.players[0].equipment['武器']).toBe('wp-zg');
  });

  it('cardMap 完整性:装备事件的卡在回放视图 cardMap 中可查', async () => {
    const weapon: Card = {
      id: 'wp-zg',
      name: '诸葛连弩',
      suit: '♣',
      color: '黑',
      rank: 'A',
      type: '装备牌',
      subtype: '武器',
      range: 1,
    };
    const slash: Card = {
      id: 'k1',
      name: '杀',
      suit: '♠',
      color: '黑',
      rank: '7',
      type: '基本牌',
    };

    const state: GameState = createGameState({
      players: [
        makePlayer(0, 'P0', [weapon.id, slash.id], ['杀', '装备通用']),
        makePlayer(1, 'P1', [], ['闪']),
      ],
      cardMap: { [weapon.id]: weapon, [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      rngSeed: 42,
      meta: { gameId: 'test-replay-equip2', createdAt: Date.now() },
    });

    const h = new SkillTestHarness();
    await h.setup(state);
    await registerSkillsFromState(state);

    const recorder = new ReplayRecorder();
    const viewers = [0, 1];
    for (const v of viewers) {
      recorder.record(v, buildView(h.state, v), []);
    }

    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: weapon.id },
      baseSeq: state.seq,
    });
    for (const v of viewers) {
      const session = h.player(v);
      const events = session.processEvents();
      recorder.record(v, session.processedView, events);
    }

    const file = recorder.finalize({
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['P0', 'P1'],
    });

    // initialView 的 cardMap 应含武器卡
    const initCardMap = file.seats[0].initialView.cardMap;
    console.log('initialView cardMap has weapon?', weapon.id in initCardMap);

    // 回放视图的 cardMap 也应含武器卡
    const replayed = getViewAt(file, 0, file.seats[0].events.length)!;
    console.log('replayed cardMap has weapon?', weapon.id in replayed.cardMap);
    console.log('replayed equipment:', replayed.players[0].equipment);
    if (replayed.players[0].equipment['武器']) {
      const c = replayed.cardMap[replayed.players[0].equipment['武器']];
      console.log('weapon card in replayed cardMap:', c);
    }
  });
});
