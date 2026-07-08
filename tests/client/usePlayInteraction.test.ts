// @vitest-environment jsdom
// usePlayInteraction hook 行为测试。
// 来源:debug 模式下制衡选牌状态在回合超时切换玩家后未清除的 bug 修复。
// 归并建议:此文件是 client 出牌交互状态机 hook 的测试基座,
//   后续 transformMode/distribute/选牌等相关回归均应追加到此处,勿再为单个 bug 新建孤岛文件。
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { usePlayInteraction } from '@/hooks/usePlayInteraction';
import type { PlayInteractionParams } from '@/hooks/usePlayInteraction';
import { defaultPlayActive } from '@engine/action-active';
import type { SkillActionDef } from '@/skillActionRegistry';
import type { Card, DistributePrompt, GameView, Json } from '@engine/types';

// ─── 测试夹具 ───

/** 制衡 action(与 engine/skills/制衡.ts onMount 声明同源):
 *  activeWhen = 出牌阶段 + 当前视角回合 + 无阻塞 pending + 本回合未用过制衡。 */
function makeZhihengAction(): SkillActionDef {
  return {
    skillId: '制衡',
    ownerId: 0,
    actionType: 'use',
    label: '制衡',
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'select',
      title: '制衡：选择要弃置的牌（可多选）',
      source: 'handAndEquip',
      minTotal: 1,
      maxTotal: 99,
    },
    activeWhen: (ctx) =>
      defaultPlayActive(ctx) &&
      !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.['制衡/usedThisTurn'],
  };
}

/** 最小合法 GameView。currentPlayerIndex 控制回合归属,phase 控制阶段,
 *  players[0].turnUsage 控制制衡是否已用。 */
function makeView(currentPlayerIndex: number, p0TurnUsage?: Record<string, Json>): GameView {
  return {
    viewer: 0,
    currentPlayerIndex,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: 'P0',
        character: '孙权',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['制衡'],
        handCount: 4,
        hand: [],
        marks: [],
        turnUsage: p0TurnUsage ?? {},
      },
      {
        index: 1,
        name: 'P1',
        character: 'X',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 4,
        marks: [],
      },
    ],
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

function makeParams(
  view: GameView,
  skillActions: SkillActionDef[],
  perspectiveIdx = 0,
): PlayInteractionParams {
  return {
    view,
    perspectiveIdx,
    perspectiveHand: [] as Card[],
    skillActions,
    pending: null,
    isDiscardPhase: false,
    discardMin: 0,
    discardMax: 0,
    isPerspectiveAwaiting: false,
    pendingRespondInfo: null,
    broadcastKey: '',
    markBroadcastSkipped: () => {},
    pendingTargetIdx: -1,
    send: () => {},
    handListRef: { current: null },
  };
}

const ZHIHENG_PROMPT: DistributePrompt = {
  type: 'distribute',
  mode: 'select',
  title: '制衡：选择要弃置的牌（可多选）',
  source: 'handAndEquip',
  minTotal: 1,
  maxTotal: 99,
};

describe('usePlayInteraction · distribute(主动技)选牌状态自动取消', () => {
  it('回合切换(出牌窗口超时→引擎结束回合)后清除制衡选牌状态', () => {
    const action = makeZhihengAction();
    const { result, rerender } = renderHook(
      ({ view }) => usePlayInteraction(true, true, makeParams(view, [action])),
      { initialProps: { view: makeView(0) } },
    );

    // 玩家点制衡按钮 → 进入选牌状态
    act(() => {
      result.current.setDistributeMode({
        skillId: '制衡',
        actionType: 'use',
        prompt: ZHIHENG_PROMPT,
      });
    });
    expect(result.current.distributeMode).not.toBeNull();
    expect(result.current.isDistributeActive).toBe(true);

    // 出牌窗口超时:引擎结束回合,currentPlayerIndex 切到下一玩家
    rerender({ view: makeView(1) });

    // action 失活 → 自动清除,UI 不再卡在制衡待选牌
    expect(result.current.distributeMode).toBeNull();
    expect(result.current.isDistributeActive).toBe(false);
  });

  it('debug 切换视角到非当前回合玩家后清除制衡选牌状态', () => {
    const action = makeZhihengAction();
    const { result, rerender } = renderHook(
      ({ view, perspectiveIdx }) =>
        usePlayInteraction(true, true, makeParams(view, [action], perspectiveIdx)),
      { initialProps: { view: makeView(0), perspectiveIdx: 0 } },
    );

    act(() => {
      result.current.setDistributeMode({
        skillId: '制衡',
        actionType: 'use',
        prompt: ZHIHENG_PROMPT,
      });
    });
    expect(result.current.isDistributeActive).toBe(true);

    // debug 模式切到 P1 视角:perspectiveIdx=1 不再是 currentPlayerIndex=0
    rerender({ view: makeView(0), perspectiveIdx: 1 });

    expect(result.current.distributeMode).toBeNull();
    expect(result.current.isDistributeActive).toBe(false);
  });

  it('action 仍 active 时不误清除选牌状态(手牌/view 更新)', () => {
    const action = makeZhihengAction();
    const { result, rerender } = renderHook(
      ({ view }) => usePlayInteraction(true, true, makeParams(view, [action])),
      { initialProps: { view: makeView(0) } },
    );

    act(() => {
      result.current.setDistributeMode({
        skillId: '制衡',
        actionType: 'use',
        prompt: ZHIHENG_PROMPT,
      });
    });
    // 仍是 P0 出牌阶段(只是手牌/view 抖动)→ 选牌状态保留
    rerender({ view: makeView(0) });
    expect(result.current.distributeMode).not.toBeNull();
    expect(result.current.isDistributeActive).toBe(true);
  });

  it('技能 action 被卸载(skillActions 不再含该 action)时清除选牌状态', () => {
    const action = makeZhihengAction();
    const { result, rerender } = renderHook(
      ({ view, actions }) => usePlayInteraction(true, true, makeParams(view, actions)),
      { initialProps: { view: makeView(0), actions: [action] } },
    );

    act(() => {
      result.current.setDistributeMode({
        skillId: '制衡',
        actionType: 'use',
        prompt: ZHIHENG_PROMPT,
      });
    });
    expect(result.current.isDistributeActive).toBe(true);

    // 技能被卸载(如换将)→ skillActions 不含制衡 action
    rerender({ view: makeView(0), actions: [] });

    expect(result.current.distributeMode).toBeNull();
    expect(result.current.isDistributeActive).toBe(false);
  });
});
