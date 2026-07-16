// @vitest-environment jsdom
// 复现测试2:装备后卸下,验证回放各 step 的 equipment 正确性。
// 场景:P0 装备诸葛连弩(step A) → P0 卸下(step B) → 回放验证各 step
import { describe, it, expect } from 'vitest';
import { dispatchAndWait, fireTimeoutAndWait, SkillTestHarness } from '../engine-harness';
import { registerSkillsFromState, applyAtom, buildView } from '../../src/engine/create-engine';
import { ReplayRecorder } from '../../src/client/replay/recorder';
import { getViewAt } from '../../src/client/replay/replayEngine';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import * as fs from 'node:fs';

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

describe('回放装备卸下复现', () => {
  it('P0 装备 → 卸下:回放各 step 的 equipment 应正确变化', async () => {
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
      meta: { gameId: 'test-replay-equip-unequip', createdAt: Date.now() },
    });

    const h = new SkillTestHarness();
    await h.setup(state);
    await registerSkillsFromState(state);

    const recorder = new ReplayRecorder();
    const viewers = [0, 1];
    for (const v of viewers) {
      recorder.record(v, buildView(h.state, v), []);
    }

    // step 1: 装备诸葛连弩
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

    // step 2: 卸下武器
    await applyAtom(state, { type: '卸下', player: 0, slot: '武器' });
    for (const v of viewers) {
      const session = h.player(v);
      // rebuildView 同步 processedView 到当前 state
      session.rebuildView();
    }
    // 卸下是直接 applyAtom,没经过 dispatch,需要手动记录事件
    // 取最近的 atom 历史
    const newEvents0 = h.player(0).newEvents();
    const newEvents1 = h.player(1).newEvents();
    recorder.record(0, h.player(0).processedView, newEvents0);
    recorder.record(1, h.player(1).processedView, newEvents1);

    const file = recorder.finalize({
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['P0', 'P1'],
    });

    // 逐步打印 equipment 状态
    const total = file.seats[0].events.length;
    console.log('=== P0 回放各 step 的 equipment ===');
    for (let step = 0; step <= total; step++) {
      const v = getViewAt(file, 0, step)!;
      const eq = v.players[0].equipment;
      const evtType = file.seats[0].events[step - 1]?.event.type ?? '(initial)';
      console.log(`step=${step} event=${evtType}: 武器=${eq['武器'] ?? '(空)'}`);
    }

    // 关键断言:
    // 1. step=0:无装备
    expect(getViewAt(file, 0, 0)!.players[0].equipment['武器']).toBeUndefined();
    // 2. 装备后:有武器
    const equipIdx = file.seats[0].events.findIndex((e) => e.event.type === '装备');
    expect(getViewAt(file, 0, equipIdx + 1)!.players[0].equipment['武器']).toBe('wp-zg');
    // 3. 卸下后:无武器
    const unequipIdx = file.seats[0].events.findIndex((e) => e.event.type === '卸下');
    console.log('装备事件 step=', equipIdx + 1, '卸下事件 step=', unequipIdx + 1);
    if (unequipIdx >= 0) {
      const afterUnequip = getViewAt(file, 0, unequipIdx + 1)!;
      console.log('卸下后 equipment:', afterUnequip.players[0].equipment);
      expect(afterUnequip.players[0].equipment['武器']).toBeUndefined();
    }

    // 导出录像
    fs.writeFileSync('/tmp/sgs-replay-unequip.json', JSON.stringify(file, null, 2));
    console.log('录像已导出到 /tmp/sgs-replay-unequip.json');
  });
});
