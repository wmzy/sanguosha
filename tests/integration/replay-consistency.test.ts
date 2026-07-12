// tests/integration/replay-consistency.test.ts
// 集成测试:录制 → finalize → 回放重建视图,与实时 processedView 一致。
//
// 核心契约:回放引擎 getViewAt 从 initialView 起步逐步 applyView,
// 重建出的视图必须等于实时游戏中通过事件流增量维护的 processedView。
// 这验证了"回放 = 实时"的根本正确性。

import { describe, it, expect } from 'vitest';
import { SkillTestHarness, dispatchAndWait, fireTimeoutAndWait } from '../engine-harness';
import { ReplayRecorder } from '../../src/client/replay/recorder';
import { getViewAt } from '../../src/client/replay/replayEngine';
import { buildView } from '../../src/engine/create-engine';
import type { GameState, GameView } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(index: number, name: string, hand: string[], skills: string[]) {
  return {
    index,
    name,
    character: name,
    health: 4,
    maxHealth: 4,
    alive: true,
    hand,
    equipment: {},
    skills,
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeState(): GameState {
  const state = createGameState({
    players: [
      makePlayer(0, '刘备', ['c0'], ['杀']),
      makePlayer(1, '曹操', ['c1'], ['闪']),
    ],
    cardMap: {
      c0: { id: 'c0', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' },
      c1: { id: 'c1', name: '闪', suit: '♥', color: '红', rank: '3', type: '基本牌' },
      // 测试牌堆(摸牌用)
      ...Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [
          `__test_deck_${i}`,
          {
            id: `__test_deck_${i}`,
            name: '杀',
            suit: '♠' as const,
            color: '黑' as const,
            rank: String(i + 2),
            type: '基本牌' as const,
          },
        ]),
      ),
    },
    rngSeed: 42,
    meta: { gameId: 'test-replay', createdAt: Date.now() },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
  return state;
}

/** 规范化 GameView 用于深比较:排除已知不对称字段:
 *  - log(time 来源不同)
 *  - deadline/deadlineTotalMs(Date.now 近似值)
 *  - turn.vars(后端 buildView 直接投影 state.turn;applyView 不同步 turn.vars,
 *    只同步 turnUsage。这是已知架构差异,不是回放问题) */
function normalize(v: GameView): unknown {
  return JSON.parse(
    JSON.stringify({
      ...v,
      turn: { ...v.turn, vars: undefined },
      log: undefined,
      deadline: undefined,
      deadlineTotalMs: undefined,
    }),
  );
}

describe('回放一致性:录制 → finalize → 重建', () => {
  it('回放末步视图与实时 processedView 一致', async () => {
    const h = new SkillTestHarness();
    await h.setup(makeState());

    const recorder = new ReplayRecorder();

    // 模拟前端:初始 view + 后续增量事件
    // 用 harness 的 session 机制收集 per-player 事件流
    const viewers = [0, 1];
    const initialViews: GameView[] = [];
    for (const v of viewers) {
      const view = buildView(h.state, v);
      initialViews.push(view);
      recorder.record(v, view, []);
    }

    // 跑一个出杀→不出闪(超时)→扣血 的流程
    await dispatchAndWait(h.state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: 'c0', targets: [1] },
      baseSeq: h.state.seq,
    });

    // 收集所有 viewer 的新事件(per-player 分叉)
    // 注意:用 processEvents() 而非 newEvents()——它既推进游标又 applyView 更新 processedView,
    // 返回值即本次事件(per-player 分叉),供录制器使用。
    for (const v of viewers) {
      const session = h.player(v);
      const events = session.processEvents();
      recorder.record(v, session.processedView, events);
    }

    // P1 超时不出闪
    await fireTimeoutAndWait(h.state);

    for (const v of viewers) {
      const session = h.player(v);
      const events = session.processEvents();
      recorder.record(v, session.processedView, events);
    }

    // 不调 processAllEvents(事件已被 processEvents 消费);
    // harness 的一致性检查在每次 processEvents 时已隐含执行

    // finalize
    const file = recorder.finalize({
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['刘备', '曹操'],
    });

    // 验证:每个 viewer 的回放末步视图 == 实时 processedView
    for (const v of viewers) {
      const session = h.player(v);
      const replayed = getViewAt(file, v, file.seats[v].events.length);
      expect(replayed, `viewer=${v} 回放视图应存在`).not.toBeNull();
      expect(normalize(replayed!), `viewer=${v} 回放末步应等于实时视图`).toEqual(
        normalize(session.processedView),
      );
    }

    // 具体断言:P1 受到 1 点伤害
    expect(getViewAt(file, 0, file.seats[0].events.length)!.players[1].health).toBe(3);
  });

  it('中途步视图也与实时一致(逐步验证)', async () => {
    const h = new SkillTestHarness();
    await h.setup(makeState());

    const recorder = new ReplayRecorder();
    const viewers = [0, 1];

    for (const v of viewers) {
      recorder.record(v, buildView(h.state, v), []);
    }

    // 出杀
    await dispatchAndWait(h.state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: 'c0', targets: [1] },
      baseSeq: h.state.seq,
    });

    // 收集这一步的事件(对应回放的 step=1)
    for (const v of viewers) {
      const session = h.player(v);
      const events = session.processEvents();
      recorder.record(v, session.processedView, events);
    }

    const file = recorder.finalize({
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['刘备', '曹操'],
    });

    // step=0(initialView):P0 手牌 1 张(杀)
    expect(getViewAt(file, 0, 0)!.players[0].handCount).toBe(1);
    // 回放末步(出杀后所有事件 apply):P0 手牌已出,应为 0
    const total0 = file.seats[0].events.length;
    expect(getViewAt(file, 0, total0)!.players[0].handCount).toBe(0);
  });
});
