// @vitest-environment jsdom
// usePlayInteraction hook 行为测试。
// 来源:debug 模式下制衡选牌状态在回合超时切换玩家后未清除的 bug 修复。
// 归并建议:此文件是 client 出牌交互状态机 hook 的测试基座,
//   后续 transformMode/distribute/选牌等相关回归均应追加到此处,勿再为单个 bug 新建孤岛文件。
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { usePlayInteraction } from '@/hooks/usePlayInteraction';
import type { PlayInteractionParams } from '@/hooks/usePlayInteraction';
import { defaultPlayActive } from '@engine/action-active';
import type { SkillActionDef } from '@/skillActionRegistry';
import type { Card, DistributePrompt, GameView, Json, PendingView } from '@engine/types';

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

// ─── 出牌模式(派生量 + handlers)测试夹具 ───
// 以下 describe 聚焦 usePlayInteraction 尚未覆盖的分支:playButtonState 派生、
// handleCardClick/handlePlayCard/handleTargetClick/handleRespond/handleSkillAction、
// 转化模式、distribute 选牌/提交、弃牌确认、回合结束。

/** 构造卡牌(默认杀),允许覆盖字段。 */
function makeCard(partial: Partial<Card> & { id: string }): Card {
  return {
    name: '杀',
    suit: '♠',
    color: '黑',
    rank: '7',
    type: '基本牌',
    subtype: '杀',
    ...partial,
  };
}

const KILL_CARD = makeCard({ id: 'c-kill', name: '杀', subtype: '杀' });
const PEACH_CARD = makeCard({ id: 'c-peach', name: '桃', subtype: '桃' });
const TRICK_CARD = makeCard({
  id: 'c-trick',
  name: '无中生有',
  type: '锦囊牌',
  trickSubtype: '普通锦囊',
});
const DELAY_TRICK_CARD = makeCard({
  id: 'c-delay',
  name: '乐不思蜀',
  type: '锦囊牌',
  trickSubtype: '延时锦囊',
});
const BORROW_CARD = makeCard({
  id: 'c-borrow',
  name: '借刀杀人',
  type: '锦囊牌',
  trickSubtype: '普通锦囊',
});
const RED_CARD_A = makeCard({ id: 'c-red-a', name: '闪', color: '红' });
const RED_CARD_B = makeCard({ id: 'c-red-b', name: '火杀', color: '红', subtype: '杀' });

/** 杀 use action:需选存活目标 */
function killUseAction(ownerId = 0): SkillActionDef {
  return {
    skillId: '杀',
    ownerId,
    actionType: 'use',
    label: '杀',
    prompt: {
      type: 'useCardAndTarget',
      title: '出杀',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1, filter: (v, i) => v.players[i]?.alive === true },
    },
  };
}

/** 桃 use action:自动以自己为目标(selfTarget) */
function peachUseAction(ownerId = 0): SkillActionDef {
  return {
    skillId: '桃',
    ownerId,
    actionType: 'use',
    label: '桃',
    prompt: {
      type: 'useCardAndTarget',
      title: '出桃',
      cardFilter: { filter: (c) => c.name === '桃', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
      selfTarget: true,
    },
  };
}

/** 无目标 use action(无中生有):useCard prompt,无 targetFilter */
function trickNoTargetAction(ownerId = 0): SkillActionDef {
  return {
    skillId: '无中生有',
    ownerId,
    actionType: 'use',
    label: '无中生有',
    prompt: {
      type: 'useCard',
      title: '无中生有',
      cardFilter: { filter: (c) => c.name === '无中生有', min: 1, max: 1 },
    },
  };
}

/** 乐不思蜀(延时锦囊)use action:需目标,出牌参数为单数 target 字段 */
function delayTrickAction(ownerId = 0): SkillActionDef {
  return {
    skillId: '乐不思蜀',
    ownerId,
    actionType: 'use',
    label: '乐不思蜀',
    prompt: {
      type: 'useCardAndTarget',
      title: '乐不思蜀',
      cardFilter: { filter: (c) => c.name === '乐不思蜀', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1, filter: (v, i) => v.players[i]?.alive === true },
    },
  };
}

/** 借刀杀人 use action:多槽位目标(slots[2],A 须持武器 + B 任意) */
function borrowSwordAction(ownerId = 0): SkillActionDef {
  return {
    skillId: '借刀杀人',
    ownerId,
    actionType: 'use',
    label: '借刀杀人',
    prompt: {
      type: 'useCardAndTarget',
      title: '借刀杀人',
      cardFilter: { filter: (c) => c.name === '借刀杀人', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 2,
        slots: [
          { label: 'A', filter: (v, i) => !!v.players[i]?.equipment?.['武器'] },
          { label: 'B', filter: () => true },
        ],
      },
    },
  };
}

/** 武圣(单卡转化)use action:红牌当杀 */
function wushengAction(ownerId = 0): SkillActionDef {
  return {
    skillId: '武圣',
    ownerId,
    actionType: 'use',
    label: '武圣',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '武圣',
      cardFilter: { filter: (c) => c.color === '红', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1, filter: (v, i) => v.players[i]?.alive === true },
    },
    transform: (card) => ({ name: '杀', sourceCardId: card.id, fromSkill: '武圣' }),
  };
}

/** 丈八蛇矛(多卡转化)use action:两牌当杀 */
function zhangbaAction(ownerId = 0): SkillActionDef {
  return {
    skillId: '丈八蛇矛',
    ownerId,
    actionType: 'use',
    label: '丈八蛇矛',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '丈八蛇矛',
      cardFilter: { filter: () => true, min: 2, max: 2 },
      targetFilter: { min: 1, max: 1, filter: (v, i) => v.players[i]?.alive === true },
    },
    transform: (card) => ({ name: '杀', sourceCardId: card.id, fromSkill: '丈八蛇矛' }),
  };
}

/** 可配置出牌阶段视图;P1 可装武器/置为死亡。 */
function makePlayView(
  opts: { currentPlayerIndex?: number; phase?: GameView['phase']; p1Alive?: boolean; p1Weapon?: string } = {},
): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: opts.currentPlayerIndex ?? 0,
    phase: opts.phase ?? '出牌',
    turn: { round: 1, phase: opts.phase ?? '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: 'P0',
        character: '孙权',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        hand: [],
        marks: [],
      },
      {
        index: 1,
        name: 'P1',
        character: 'X',
        health: 4,
        maxHealth: 4,
        alive: opts.p1Alive ?? true,
        equipment: opts.p1Weapon ? { 武器: opts.p1Weapon } : {},
        skills: [],
        handCount: 0,
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

/** 可配置 PlayInteractionParams(出牌场景默认值:myTurn + canOperate + 出牌阶段)。 */
function makePlayParams(opts: {
  view: GameView;
  skillActions: SkillActionDef[];
  perspectiveIdx?: number;
  perspectiveHand?: Card[];
  send?: PlayInteractionParams['send'];
  isDiscardPhase?: boolean;
  discardMin?: number;
  discardMax?: number;
  isPerspectiveAwaiting?: boolean;
  pending?: PendingView | null;
  pendingRespondInfo?: { skillId: string; cardFilter?: (c: Card) => boolean } | null;
  broadcastKey?: string;
  markBroadcastSkipped?: (k: string) => void;
  pendingTargetIdx?: number;
}): PlayInteractionParams {
  return {
    view: opts.view,
    perspectiveIdx: opts.perspectiveIdx ?? 0,
    perspectiveHand: opts.perspectiveHand ?? [],
    skillActions: opts.skillActions,
    pending: opts.pending ?? null,
    isDiscardPhase: opts.isDiscardPhase ?? false,
    discardMin: opts.discardMin ?? 0,
    discardMax: opts.discardMax ?? 0,
    isPerspectiveAwaiting: opts.isPerspectiveAwaiting ?? false,
    pendingRespondInfo: opts.pendingRespondInfo ?? null,
    broadcastKey: opts.broadcastKey ?? '',
    markBroadcastSkipped: opts.markBroadcastSkipped ?? (() => {}),
    pendingTargetIdx: opts.pendingTargetIdx ?? -1,
    send: opts.send ?? (() => {}),
    handListRef: { current: null },
  };
}

/**
 * 渲染 hook,params 经 initialProps 保持稳定。
 * 关键:params 必须在 render 函数外构造一次,否则每次渲染新建 pending/view 对象,
 * 触发 hook 内 `useEffect(...,[pending])` 反复 setState → 无限渲染循环(内存溢出)。
 */
function renderPlay(p: PlayInteractionParams, isMyTurn = true, canOperate = true) {
  return renderHook((params: PlayInteractionParams) => usePlayInteraction(isMyTurn, canOperate, params), {
    initialProps: p,
  });
}

/** 读 vi.fn() send 的调用参数(去掉 preceding 形参,聚焦 skillId/actionType/params)。 */
function sentCalls(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.map((call: any[]) => ({
    skillId: call[0] as string,
    actionType: call[1] as string,
    params: call[2] as Record<string, Json>,
  }));
}

describe('usePlayInteraction · playButtonState 派生(出牌按钮可点击性)', () => {
  it('需目标的牌(杀)未选目标时 canPlay=false 并提示选目标', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [killUseAction()],
        perspectiveHand: [KILL_CARD],
      }),
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    expect(result.current.playButtonState).toEqual({ canPlay: false, targetLabel: ' (请选目标)' });
  });

  it('需目标的牌选了目标后 canPlay=true,label 标注目标', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [killUseAction()],
        perspectiveHand: [KILL_CARD],
      }),
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    act(() => result.current.handleTargetClick('P1'));
    expect(result.current.playButtonState).toEqual({ canPlay: true, targetLabel: ' → P1' });
  });

  it('自动以自己为目标的牌(桃)无需选目标,canPlay=true', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [peachUseAction()],
        perspectiveHand: [PEACH_CARD],
      }),
    );
    act(() => result.current.handleCardClick(PEACH_CARD));
    expect(result.current.playButtonState).toEqual({ canPlay: true, targetLabel: '' });
  });

  it('无目标牌(无中生有)无需选目标,canPlay=true', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [trickNoTargetAction()],
        perspectiveHand: [TRICK_CARD],
      }),
    );
    act(() => result.current.handleCardClick(TRICK_CARD));
    expect(result.current.playButtonState).toEqual({ canPlay: true, targetLabel: '' });
  });

  it('多槽位目标(借刀杀人)需选 A+B 两个目标才可出', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView({ p1Weapon: 'w1' }),
        skillActions: [borrowSwordAction()],
        perspectiveHand: [BORROW_CARD],
      }),
    );
    act(() => result.current.handleCardClick(BORROW_CARD));
    // 仅选 A
    act(() => result.current.handleTargetClick('P1'));
    expect(result.current.playButtonState).toEqual({
      canPlay: false,
      targetLabel: ' (请选 A/B 两个目标)',
    });
    // 再选 B
    act(() => result.current.handleTargetClick('P0'));
    expect(result.current.playButtonState).toEqual({
      canPlay: true,
      targetLabel: ' → A=P1 B=P0',
    });
  });
});

describe('usePlayInteraction · handlePlayCard(出牌参数构造)', () => {
  it('出无目标牌发送 {cardId}', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [trickNoTargetAction()],
        perspectiveHand: [TRICK_CARD],
        send,
      }),
    );
    act(() => result.current.handleCardClick(TRICK_CARD));
    act(() => result.current.handlePlayCard());
    expect(sentCalls(send)).toEqual([
      { skillId: '无中生有', actionType: 'use', params: { cardId: 'c-trick' } },
    ]);
  });

  it('出杀(需目标)发送 {cardId, targets:[目标座次]}', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [killUseAction()],
        perspectiveHand: [KILL_CARD],
        send,
      }),
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    act(() => result.current.handleTargetClick('P1'));
    act(() => result.current.handlePlayCard());
    expect(sentCalls(send)).toEqual([
      { skillId: '杀', actionType: 'use', params: { cardId: 'c-kill', targets: [1] } },
    ]);
  });

  it('出桃(自动以自己为目标)发送 targets=[自己座次]', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [peachUseAction()],
        perspectiveHand: [PEACH_CARD],
        send,
      }),
    );
    act(() => result.current.handleCardClick(PEACH_CARD));
    act(() => result.current.handlePlayCard());
    expect(sentCalls(send)).toEqual([
      { skillId: '桃', actionType: 'use', params: { cardId: 'c-peach', targets: [0] } },
    ]);
  });

  it('出延时锦囊(需目标)发送单数 target 字段(非 targets 数组)', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [delayTrickAction()],
        perspectiveHand: [DELAY_TRICK_CARD],
        send,
      }),
    );
    act(() => result.current.handleCardClick(DELAY_TRICK_CARD));
    act(() => result.current.handleTargetClick('P1'));
    act(() => result.current.handlePlayCard());
    expect(sentCalls(send)).toEqual([
      { skillId: '乐不思蜀', actionType: 'use', params: { cardId: 'c-delay', target: 1 } },
    ]);
  });

  it('借刀杀人(多槽位)选 A+B 后发送 {cardId, target, killTarget}', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView({ p1Weapon: 'w1' }),
        skillActions: [borrowSwordAction()],
        perspectiveHand: [BORROW_CARD],
        send,
      }),
    );
    act(() => result.current.handleCardClick(BORROW_CARD));
    act(() => result.current.handleTargetClick('P1')); // A
    act(() => result.current.handleTargetClick('P0')); // B
    act(() => result.current.handlePlayCard());
    expect(sentCalls(send)).toEqual([
      { skillId: '借刀杀人', actionType: 'use', params: { cardId: 'c-borrow', target: 1, killTarget: 0 } },
    ]);
  });
});

describe('usePlayInteraction · handleTargetClick(多槽位目标选择)', () => {
  it('isTargetable 对无武器玩家(slot A)返回 false', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView({ p1Weapon: 'w1' }),
        skillActions: [borrowSwordAction()],
        perspectiveHand: [BORROW_CARD],
      }),
    );
    act(() => result.current.handleCardClick(BORROW_CARD));
    // slot A:P0 无武器 → 不可选;P1 有武器 → 可选
    expect(result.current.isTargetable(0)).toBe(false);
    expect(result.current.isTargetable(1)).toBe(true);
  });

  it('选了 A 后再点 B 又点 B 取消 killTarget(slot B 可切换)', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView({ p1Weapon: 'w1' }),
        skillActions: [borrowSwordAction()],
        perspectiveHand: [BORROW_CARD],
      }),
    );
    act(() => result.current.handleCardClick(BORROW_CARD));
    act(() => result.current.handleTargetClick('P1')); // A
    act(() => result.current.handleTargetClick('P0')); // B
    expect(result.current.selectedKillTarget).toBe('P0');
    act(() => result.current.handleTargetClick('P0')); // 取消 B
    expect(result.current.selectedKillTarget).toBeNull();
  });

  it('普通目标牌点同一目标两次取消选择', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [killUseAction()],
        perspectiveHand: [KILL_CARD],
      }),
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    act(() => result.current.handleTargetClick('P1'));
    expect(result.current.selectedTarget).toBe('P1');
    act(() => result.current.handleTargetClick('P1'));
    expect(result.current.selectedTarget).toBeNull();
  });
});

describe('usePlayInteraction · handleCardClick 选牌与切换', () => {
  it('出牌模式:点牌选中,再点同一张取消', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [killUseAction()],
        perspectiveHand: [KILL_CARD],
      }),
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    expect(result.current.selectedCardId).toBe('c-kill');
    act(() => result.current.handleCardClick(KILL_CARD));
    expect(result.current.selectedCardId).toBeNull();
  });

  it('阻塞 pending 出现后自动清除选牌(避免取消选择残留)', () => {
    const freeParams = makePlayParams({
      view: makePlayView(),
      skillActions: [killUseAction()],
      perspectiveHand: [KILL_CARD],
      pending: {
        type: 'awaits',
        atom: { type: '出牌窗口', player: 0 },
        target: 0,
        prompt: { type: 'confirm', title: '出牌阶段' },
        isBlocking: false,
      },
    });
    const { result, rerender } = renderHook(
      ({ params, isMyTurn }: { params: PlayInteractionParams; isMyTurn: boolean }) =>
        usePlayInteraction(isMyTurn, true, params),
      { initialProps: { params: freeParams, isMyTurn: true } },
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    expect(result.current.selectedCardId).toBe('c-kill');

    const blocked = makePlayParams({
      view: makePlayView(),
      skillActions: [killUseAction()],
      perspectiveHand: [KILL_CARD],
      pending: {
        type: 'awaits',
        atom: { type: '造成伤害', source: 0, target: 1, amount: 1 },
        target: 1,
        prompt: {
          type: 'useCard',
          title: '请出闪',
          cardFilter: { filter: () => true, min: 1, max: 1 },
        },
        isBlocking: true,
      },
    });
    rerender({ params: blocked, isMyTurn: true });
    expect(result.current.selectedCardId).toBeNull();
  });

  it('进入弃牌阶段后自动清除选牌', () => {
    const playParams = makePlayParams({
      view: makePlayView({ phase: '出牌' }),
      skillActions: [killUseAction()],
      perspectiveHand: [KILL_CARD],
    });
    const { result, rerender } = renderHook(
      ({ params }: { params: PlayInteractionParams }) => usePlayInteraction(true, true, params),
      { initialProps: { params: playParams } },
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    expect(result.current.selectedCardId).toBe('c-kill');

    rerender({
      params: makePlayParams({
        view: makePlayView({ phase: '弃牌' }),
        skillActions: [killUseAction()],
        perspectiveHand: [KILL_CARD],
      }),
    });
    expect(result.current.selectedCardId).toBeNull();
  });

  it('出牌模式:切换选中另一张牌', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [killUseAction(), peachUseAction()],
        perspectiveHand: [KILL_CARD, PEACH_CARD],
      }),
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    expect(result.current.selectedCardId).toBe('c-kill');
    act(() => result.current.handleCardClick(PEACH_CARD));
    expect(result.current.selectedCardId).toBe('c-peach');
  });

  it('非自己回合时点牌不选中(isMyTurn=false)', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [killUseAction()],
        perspectiveHand: [KILL_CARD],
      }),
      false,
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    expect(result.current.selectedCardId).toBeNull();
  });
});

describe('usePlayInteraction · 弃牌窗口(selectedForDiscard)', () => {
  function discardParams(
    send: ReturnType<typeof vi.fn>,
    hand: Card[],
    min: number,
    max: number,
  ): PlayInteractionParams {
    const pending: PendingView = {
      type: 'awaits',
      atom: { type: '请求回应', params: { requestType: '__弃牌' } } as unknown as PendingView['atom'],
      prompt: { type: 'confirm', title: '弃牌' },
      target: 0,
      isBlocking: true,
    };
    return makePlayParams({
      view: makePlayView(),
      skillActions: [],
      perspectiveHand: hand,
      send: send as PlayInteractionParams['send'],
      isDiscardPhase: true,
      discardMin: min,
      discardMax: max,
      isPerspectiveAwaiting: true,
      pending,
    });
  }

  it('选牌增删,达到 discardMax 后不再增加', () => {
    const { result } = renderPlay(discardParams(vi.fn(), [KILL_CARD, PEACH_CARD, TRICK_CARD], 1, 2));
    act(() => result.current.handleCardClick(KILL_CARD));
    act(() => result.current.handleCardClick(PEACH_CARD));
    expect(result.current.selectedForDiscard.size).toBe(2);
    // 达到上限 2,第三张不加入
    act(() => result.current.handleCardClick(TRICK_CARD));
    expect(result.current.selectedForDiscard.size).toBe(2);
    // 再点已选的牌取消
    act(() => result.current.handleCardClick(KILL_CARD));
    expect(result.current.selectedForDiscard.size).toBe(1);
  });

  it('选够后 respond 触发 confirmDiscard 发送 cardIds', () => {
    const send = vi.fn();
    const { result } = renderPlay(discardParams(send, [KILL_CARD, PEACH_CARD], 1, 2));
    act(() => result.current.handleCardClick(KILL_CARD));
    act(() => result.current.handleRespond());
    expect(sentCalls(send)).toEqual([
      { skillId: '系统规则', actionType: 'respond', params: { cardIds: ['c-kill'] } },
    ]);
    // 提交后清空
    expect(result.current.selectedForDiscard.size).toBe(0);
  });

  it('未选够(discardMin)时 respond fallback 取手牌末尾 discardMin 张', () => {
    const send = vi.fn();
    const { result } = renderPlay(discardParams(send, [KILL_CARD, PEACH_CARD, TRICK_CARD], 2, 2));
    // 不选任何牌直接 respond → fallback 取末尾 2 张
    act(() => result.current.handleRespond());
    expect(sentCalls(send)).toEqual([
      { skillId: '系统规则', actionType: 'respond', params: { cardIds: ['c-peach', 'c-trick'] } },
    ]);
  });

  it('clearDiscard 手动清空弃牌选中', () => {
    const { result } = renderPlay(discardParams(vi.fn(), [KILL_CARD, PEACH_CARD], 1, 2));
    act(() => result.current.handleCardClick(KILL_CARD));
    act(() => result.current.handleCardClick(PEACH_CARD));
    expect(result.current.selectedForDiscard.size).toBe(2);
    act(() => result.current.clearDiscard());
    expect(result.current.selectedForDiscard.size).toBe(0);
  });
});

describe('usePlayInteraction · handleRespond(回应询问)', () => {
  function respondParams(
    send: ReturnType<typeof vi.fn>,
    opts: { cardFilter?: (c: Card) => boolean; pendingTargetIdx?: number; markSkip?: (k: string) => void } = {},
  ): PlayInteractionParams {
    const pending: PendingView = {
      type: 'awaits',
      atom: { type: '询问闪', params: {} } as unknown as PendingView['atom'],
      prompt: { type: 'confirm', title: '出闪?' },
      target: 0,
      isBlocking: true,
    };
    return makePlayParams({
      view: makePlayView(),
      skillActions: [],
      perspectiveHand: [KILL_CARD, PEACH_CARD],
      send: send as PlayInteractionParams['send'],
      isPerspectiveAwaiting: true,
      pending,
      pendingRespondInfo: { skillId: '闪', cardFilter: opts.cardFilter },
      pendingTargetIdx: opts.pendingTargetIdx ?? 0,
      markBroadcastSkipped: opts.markSkip,
    });
  }

  it('点击符合 cardFilter 的牌触发 send respond {cardId}', () => {
    const send = vi.fn();
    const { result } = renderPlay(respondParams(send, { cardFilter: (c) => c.name === '杀' }));
    // 点杀(符合)→ 发送
    act(() => result.current.handleCardClick(KILL_CARD));
    expect(sentCalls(send)).toEqual([
      { skillId: '闪', actionType: 'respond', params: { cardId: 'c-kill' } },
    ]);
  });

  it('点击不符合 cardFilter 的牌不发送', () => {
    const send = vi.fn();
    const { result } = renderPlay(respondParams(send, { cardFilter: (c) => c.name === '杀' }));
    // 点桃(不符合 filter)→ 不发送
    act(() => result.current.handleCardClick(PEACH_CARD));
    expect(send).not.toHaveBeenCalled();
  });

  it('广播型 pending(pendingTargetIdx<0):respond 发送 skip 并调用 markBroadcastSkipped', () => {
    const send = vi.fn();
    const markSkip = vi.fn();
    const { result } = renderPlay(respondParams(send, { pendingTargetIdx: -1, markSkip }));
    act(() => result.current.handleRespond()); // 无 cardId
    // 广播型 pending「不回应」:发 __skip 让服务端累计(全员 skip 提前结束窗口)
    // + 本地 markBroadcastSkipped 标记避免重复弹窗。详见 commit 3c37a003。
    expect(markSkip).toHaveBeenCalledTimes(1);
    expect(sentCalls(send)).toEqual([{ skillId: '__skip', actionType: 'skip', params: {} }]);
  });

  it('非广播、无 cardId 的 respond 发送空 params', () => {
    const send = vi.fn();
    const { result } = renderPlay(respondParams(send, { pendingTargetIdx: 1 }));
    act(() => result.current.handleRespond());
    expect(sentCalls(send)).toEqual([
      { skillId: '闪', actionType: 'respond', params: {} },
    ]);
  });
});

describe('usePlayInteraction · 转化模式(transformMode)', () => {
  it('handleSkillAction 对转化型 action 进入 transformMode 并清空选牌', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [wushengAction(), killUseAction()],
        perspectiveHand: [RED_CARD_A, RED_CARD_B],
      }),
    );
    act(() => result.current.handleSkillAction(wushengAction()));
    expect(result.current.transformMode).not.toBeNull();
    expect(result.current.transformMode?.skillId).toBe('武圣');
    expect(result.current.transformMode?.wrapperName).toBe('杀');
    expect(result.current.transformMode?.minCards).toBe(1);
  });

  it('单卡转化:选红牌 + handleTransformPlay 发送 wrapper use + preceding 转化', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [wushengAction(), killUseAction()],
        perspectiveHand: [RED_CARD_A],
        send,
      }),
    );
    act(() => result.current.handleSkillAction(wushengAction()));
    act(() => result.current.handleCardClick(RED_CARD_A)); // 选中红牌
    act(() => result.current.handleTransformPlay('P1'));
    // wrapper use(杀) + preceding 武圣转化
    expect(send.mock.calls[0][0]).toBe('杀');
    expect(send.mock.calls[0][1]).toBe('use');
    expect(send.mock.calls[0][2]).toEqual({ cardId: 'c-red-a#武圣', targets: [1] });
    const preceding = send.mock.calls[0][3] as Array<{
      skillId: string;
      actionType: string;
      params: Record<string, Json>;
    }>;
    expect(preceding).toEqual([
      { skillId: '武圣', actionType: 'use', params: { cardId: 'c-red-a' } },
    ]);
    // 提交后退出转化模式
    expect(result.current.transformMode).toBeNull();
  });

  it('多卡转化(丈八蛇矛):选两张 + 提交发送双牌合成的杀', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [zhangbaAction(), killUseAction()],
        perspectiveHand: [RED_CARD_A, RED_CARD_B],
        send,
      }),
    );
    act(() => result.current.handleSkillAction(zhangbaAction()));
    // 选两张(多卡路径)
    act(() => result.current.handleCardClick(RED_CARD_A));
    act(() => result.current.handleCardClick(RED_CARD_B));
    expect(result.current.transformMode?.selectedCardIds).toEqual(['c-red-a', 'c-red-b']);
    // 再点一张取消选择
    act(() => result.current.handleCardClick(RED_CARD_A));
    expect(result.current.transformMode?.selectedCardIds).toEqual(['c-red-b']);
    act(() => result.current.handleCardClick(RED_CARD_A));
    expect(result.current.transformMode?.selectedCardIds).toEqual(['c-red-b', 'c-red-a']);
    // 提交
    act(() => result.current.handleTransformPlay('P1'));
    expect(send.mock.calls[0][0]).toBe('杀');
    expect((send.mock.calls[0][2] as Record<string, Json>).cardId).toBe(
      'c-red-b#c-red-a#丈八蛇矛',
    );
  });

  it('多卡转化选牌不足 minCards 时 handleTransformPlay 不发送', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [zhangbaAction(), killUseAction()],
        perspectiveHand: [RED_CARD_A, RED_CARD_B],
        send,
      }),
    );
    act(() => result.current.handleSkillAction(zhangbaAction()));
    act(() => result.current.handleCardClick(RED_CARD_A)); // 只选 1 张
    act(() => result.current.handleTransformPlay('P1'));
    expect(send).not.toHaveBeenCalled();
  });

  it('转化条件失活(回合结束)时自动退出转化模式', () => {
    const baseParams = makePlayParams({
      view: makePlayView({ phase: '出牌' }),
      skillActions: [wushengAction(), killUseAction()],
      perspectiveHand: [RED_CARD_A],
    });
    const { result, rerender } = renderHook(
      ({ view }) => usePlayInteraction(true, true, { ...baseParams, view }),
      { initialProps: { view: makePlayView({ phase: '出牌' }) } },
    );
    act(() => result.current.handleSkillAction(wushengAction()));
    expect(result.current.transformMode).not.toBeNull();
    // 出牌阶段结束(超时)→ 默认激活条件 defaultPlayActive 不再满足
    rerender({ view: makePlayView({ phase: '弃牌' }) });
    expect(result.current.transformMode).toBeNull();
  });

  it('cancelTransform 手动退出转化模式并清空选牌', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [wushengAction(), killUseAction()],
        perspectiveHand: [RED_CARD_A],
      }),
    );
    act(() => result.current.handleSkillAction(wushengAction()));
    act(() => result.current.handleCardClick(RED_CARD_A));
    expect(result.current.selectedCardId).toBe('c-red-a');
    act(() => result.current.cancelTransform());
    expect(result.current.transformMode).toBeNull();
    expect(result.current.selectedCardId).toBeNull();
  });
});

describe('usePlayInteraction · distribute 选牌与提交', () => {
  // 注:distribute(主动技)需 skillActions 中存在匹配且 active 的制衡 action,
  // 否则 hook 的自动取消 effect 会立即清除 distributeMode。makeZhihengAction 满足该条件。
  it('handleDistToggle 在 select 模式增删选中,且不超过 maxTotal', () => {
    const { result } = renderPlay(
      makePlayParams({ view: makePlayView(), skillActions: [makeZhihengAction()] }),
    );
    // 进入 select distribute 模式(制衡式,maxTotal=2)
    act(() =>
      result.current.setDistributeMode({
        skillId: '制衡',
        actionType: 'use',
        prompt: { ...ZHIHENG_PROMPT, maxTotal: 2 },
      }),
    );
    act(() => result.current.handleDistToggle('x1'));
    act(() => result.current.handleDistToggle('x2'));
    expect([...result.current.distSelected]).toEqual(['x1', 'x2']);
    // 超过 maxTotal=2,第三张不加入
    act(() => result.current.handleDistToggle('x3'));
    expect([...result.current.distSelected]).toEqual(['x1', 'x2']);
    // 再点已选取消
    act(() => result.current.handleDistToggle('x1'));
    expect([...result.current.distSelected]).toEqual(['x2']);
  });

  it('handleDistSubmit(select 模式)达 minTotal 后发送 cardIds 并退出', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({ view: makePlayView(), skillActions: [makeZhihengAction()], send }),
    );
    act(() =>
      result.current.setDistributeMode({
        skillId: '制衡',
        actionType: 'use',
        prompt: ZHIHENG_PROMPT,
      }),
    );
    act(() => result.current.handleDistToggle('y1'));
    act(() => result.current.handleDistToggle('y2'));
    act(() => result.current.handleDistSubmit());
    expect(sentCalls(send)).toEqual([
      { skillId: '制衡', actionType: 'use', params: { cardIds: ['y1', 'y2'] } },
    ]);
    expect(result.current.distributeMode).toBeNull();
  });

  it('handleDistSubmit(select 模式)不足 minTotal 时不发送', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({ view: makePlayView(), skillActions: [makeZhihengAction()], send }),
    );
    act(() =>
      result.current.setDistributeMode({
        skillId: '制衡',
        actionType: 'use',
        prompt: { ...ZHIHENG_PROMPT, minTotal: 2 },
      }),
    );
    act(() => result.current.handleDistToggle('z1')); // 只选 1 张,不足 minTotal=2
    act(() => result.current.handleDistSubmit());
    expect(send).not.toHaveBeenCalled();
  });

  it('handleDistClear 清空 distribute 选中与分配', () => {
    const { result } = renderPlay(
      makePlayParams({ view: makePlayView(), skillActions: [makeZhihengAction()] }),
    );
    act(() =>
      result.current.setDistributeMode({
        skillId: '制衡',
        actionType: 'use',
        prompt: ZHIHENG_PROMPT,
      }),
    );
    act(() => result.current.handleDistToggle('q1'));
    act(() => result.current.handleDistToggle('q2'));
    act(() => result.current.handleDistClear());
    expect(result.current.distSelected.size).toBe(0);
    expect(result.current.distAllocations).toEqual([]);
  });
});

// ─── 遗计/仁德(allocate / externalTargetSelection)distribute 路径 ───
// 与制衡(select)对称:遗计为被动 pending(isMyAwaiting && pending.prompt.type==='distribute'),
// 点玩家即分配选中牌;仁德为主动技(prompt 无 mode → externalTargetSelection),点玩家设为目标。

/** 遗计式 distribute prompt(被动 pending,mode=allocate)。 */
function yijiPrompt(overrides: Partial<DistributePrompt> = {}): DistributePrompt {
  return {
    type: 'distribute',
    mode: 'allocate',
    title: '遗计',
    cardIds: ['d1', 'd2'],
    allowSelf: true,
    maxPerTarget: 99,
    minTotal: 1,
    ...overrides,
  };
}

/** 构造被动 distribute(遗计)pending params。 */
function pendingDistributeParams(
  send: ReturnType<typeof vi.fn>,
  prompt: DistributePrompt,
  opts: { pendingRespondInfo?: { skillId: string } | null; hand?: Card[] } = {},
): PlayInteractionParams {
  const pending: PendingView = {
    type: 'awaits',
    atom: { type: '请求回应', params: {} } as unknown as PendingView['atom'],
    prompt,
    target: 0,
    isBlocking: true,
  };
  return makePlayParams({
    view: makePlayView(),
    skillActions: [],
    perspectiveHand: opts.hand ?? [],
    send: send as PlayInteractionParams['send'],
    isPerspectiveAwaiting: true,
    pending,
    pendingRespondInfo:
      opts.pendingRespondInfo !== undefined ? opts.pendingRespondInfo : { skillId: '遗计' },
  });
}

describe('usePlayInteraction · distribute(遗计 allocate 被动分配)', () => {
  it('选牌后点玩家分配,提交发送 allocation', () => {
    const send = vi.fn();
    const { result } = renderPlay(pendingDistributeParams(send, yijiPrompt()));
    expect(result.current.isDistributeActive).toBe(true);
    // 选两张牌
    act(() => result.current.handleDistToggle('d1'));
    act(() => result.current.handleDistToggle('d2'));
    expect(result.current.distSelected.size).toBe(2);
    // 点玩家 P1 分配(allocate 内部分配路径)
    act(() => result.current.handleTargetClick('P1'));
    expect(result.current.distSelected.size).toBe(0); // 分配后清空选中
    expect(result.current.distAllocations).toContainEqual({ target: 1, cardIds: ['d1', 'd2'] });
    // 提交
    act(() => result.current.handleDistSubmit());
    expect(sentCalls(send)).toEqual([
      {
        skillId: '遗计',
        actionType: 'respond',
        params: { allocation: [{ target: 1, cardIds: ['d1', 'd2'] }] },
      },
    ]);
  });

  it('isTargetable 在 allocate 模式遵循 allowSelf=false(不能选自己)', () => {
    const { result } = renderPlay(
      pendingDistributeParams(vi.fn(), yijiPrompt({ allowSelf: false })),
    );
    // 自己(P0)不可选,P1(存活)可选
    expect(result.current.isTargetable(0)).toBe(false);
    expect(result.current.isTargetable(1)).toBe(true);
  });

  it('isTargetable 在 select 模式始终返回 false(制衡无目标)', () => {
    const { result } = renderPlay(pendingDistributeParams(vi.fn(), { ...yijiPrompt(), mode: 'select' }));
    expect(result.current.isTargetable(0)).toBe(false);
    expect(result.current.isTargetable(1)).toBe(false);
  });

  it('点玩家分配超过 maxPerTarget 时不新增该目标的分配', () => {
    const send = vi.fn();
    // maxPerTarget=1:一次选 2 张分配给同一玩家会被拒
    const { result } = renderPlay(
      pendingDistributeParams(send, yijiPrompt({ maxPerTarget: 1 })),
    );
    act(() => result.current.handleDistToggle('d1'));
    act(() => result.current.handleDistToggle('d2'));
    act(() => result.current.handleTargetClick('P1'));
    // 2 张 > maxPerTarget(1) → 不分配,但选中仍被清空
    expect(result.current.distAllocations).toEqual([]);
    // 一张一张分配则成功(每张 1,不超限)
    act(() => result.current.handleDistToggle('d1'));
    act(() => result.current.handleTargetClick('P1'));
    expect(result.current.distAllocations).toContainEqual({ target: 1, cardIds: ['d1'] });
  });

  it('handleDistAllocate 达 maxPerTarget 后不再向该目标追加', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      pendingDistributeParams(send, yijiPrompt({ maxPerTarget: 1 })),
    );
    act(() => result.current.handleDistToggle('d1'));
    act(() => result.current.handleDistAllocate(1));
    expect(result.current.distAllocations).toEqual([{ target: 1, cardIds: ['d1'] }]);
    // 该目标已满 1,再分配一张被拒
    act(() => result.current.handleDistToggle('d2'));
    act(() => result.current.handleDistAllocate(1));
    expect(result.current.distAllocations).toEqual([{ target: 1, cardIds: ['d1'] }]);
  });

  it('pendingRespondInfo 为 null 时 skillId 回退 "系统规则"', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      pendingDistributeParams(send, yijiPrompt(), { pendingRespondInfo: null }),
    );
    act(() => result.current.handleDistToggle('d1'));
    act(() => result.current.handleTargetClick('P1'));
    act(() => result.current.handleDistSubmit());
    expect(sentCalls(send)[0].skillId).toBe('系统规则');
  });

  it('allocate 提交总数不足 minTotal 时不发送', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      pendingDistributeParams(send, yijiPrompt({ minTotal: 3 })),
    );
    act(() => result.current.handleDistToggle('d1'));
    act(() => result.current.handleTargetClick('P1')); // 只分配 1 张 < minTotal 3
    act(() => result.current.handleDistSubmit());
    expect(send).not.toHaveBeenCalled();
  });
});

describe('usePlayInteraction · distribute(仁德 externalTargetSelection 主动分配)', () => {
  /** 仁德 prompt:无 mode → externalTargetSelection=true,点玩家设为目标。 */
  const RENDE_PROMPT: DistributePrompt = {
    type: 'distribute',
    title: '仁德',
    source: 'hand',
    minTotal: 1,
    maxTotal: 99,
    allowSelf: false,
    maxPerTarget: 99,
  };

  /** 仁德 action:prompt 无 mode → externalTargetSelection=true,点玩家设为目标。 */
  function rendeAction(): SkillActionDef {
    return {
      skillId: '仁德',
      ownerId: 0,
      actionType: 'use',
      label: '仁德',
      prompt: RENDE_PROMPT,
      activeWhen: (ctx) => defaultPlayActive(ctx),
    };
  }

  it('点玩家设为目标(externalTargetSelection),提交发送单目标 allocation', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [rendeAction()],
        perspectiveHand: [KILL_CARD, PEACH_CARD],
        send,
      }),
    );
    act(() =>
      result.current.setDistributeMode({
        skillId: '仁德',
        actionType: 'use',
        prompt: RENDE_PROMPT,
      }),
    );
    expect(result.current.activeDistribute?.externalTargetSelection).toBe(true);
    // 选一张手牌
    act(() => result.current.handleDistToggle(KILL_CARD.id));
    // 点 P1 设为目标(externalTargetSelection 分支)
    act(() => result.current.handleTargetClick('P1'));
    expect(result.current.distTargetName).toBe('P1');
    // 再点 P1 取消目标
    act(() => result.current.handleTargetClick('P1'));
    expect(result.current.distTargetName).toBeNull();
    // 重新选目标并提交
    act(() => result.current.handleTargetClick('P1'));
    act(() => result.current.handleDistSubmit());
    expect(sentCalls(send)).toEqual([
      {
        skillId: '仁德',
        actionType: 'use',
        params: { allocation: [{ target: 1, cardIds: [KILL_CARD.id] }] },
      },
    ]);
  });

  it('externalTargetSelection 未选目标时提交不发送', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [rendeAction()],
        perspectiveHand: [KILL_CARD],
        send,
      }),
    );
    act(() =>
      result.current.setDistributeMode({
        skillId: '仁德',
        actionType: 'use',
        prompt: RENDE_PROMPT,
      }),
    );
    act(() => result.current.handleDistToggle(KILL_CARD.id));
    // 未点玩家(无 distTargetName)
    act(() => result.current.handleDistSubmit());
    expect(send).not.toHaveBeenCalled();
  });
});

describe('usePlayInteraction · 回合结束 / 选区清理', () => {
  it('handleEndTurn 在自己回合发送 end', () => {
    const send = vi.fn();
    const { result } = renderPlay(makePlayParams({ view: makePlayView(), skillActions: [], send }));
    act(() => result.current.handleEndTurn());
    expect(sentCalls(send)).toEqual([
      { skillId: '回合管理', actionType: 'end', params: {} },
    ]);
  });

  it('handleEndTurn 非自己回合不发送', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({ view: makePlayView({ currentPlayerIndex: 1 }), skillActions: [], send }),
      false,
    );
    act(() => result.current.handleEndTurn());
    expect(send).not.toHaveBeenCalled();
  });

  it('cancelSelection 清空选中牌与目标', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [killUseAction()],
        perspectiveHand: [KILL_CARD],
      }),
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    act(() => result.current.handleTargetClick('P1'));
    expect(result.current.selectedCardId).toBe('c-kill');
    expect(result.current.selectedTarget).toBe('P1');
    act(() => result.current.cancelSelection());
    expect(result.current.selectedCardId).toBeNull();
    expect(result.current.selectedTarget).toBeNull();
  });
});

// ─── Bug 3: 铁索连环重铸(替代出牌方式 altActions)───
// 铁索连环有 use(横置/重置)和 recast(重铸)两个 action。
// recast 的 prompt.type='useCard',actionType='recast',不属于 use action,
// 需通过 altActions 渲染为额外按钮。

describe('usePlayInteraction · altActions(替代出牌方式)', () => {
  const CHAIN_CARD = makeCard({
    id: 'c-chain',
    name: '铁索连环',
    type: '锦囊牌',
    trickSubtype: '普通锦囊',
  });

  /** 铁索连环 use action:横置/重置 1-2 名角色(需目标) */
  function chainUseAction(ownerId = 0): SkillActionDef {
    return {
      skillId: '铁索连环',
      ownerId,
      actionType: 'use',
      label: '铁索连环',
      style: 'primary',
      prompt: {
        type: 'useCardAndTarget',
        title: '铁索连环',
        cardFilter: { filter: (c) => c.name === '铁索连环', min: 1, max: 1 },
        targetFilter: { min: 1, max: 2 },
      },
      activeWhen: (ctx) =>
        defaultPlayActive(ctx) &&
        (ctx.view.players[ctx.perspectiveIdx]?.hand?.some((c) => c.name === '铁索连环') ??
          false),
    };
  }

  /** 铁索连环 recast action:重铸(弃此牌,摸一张) */
  function chainRecastAction(ownerId = 0): SkillActionDef {
    return {
      skillId: '铁索连环',
      ownerId,
      actionType: 'recast',
      label: '铁索连环·重铸',
      style: 'primary',
      prompt: {
        type: 'useCard',
        title: '铁索连环:重铸(弃此牌,摸一张)',
        cardFilter: { filter: (c) => c.name === '铁索连环', min: 1, max: 1 },
      },
      activeWhen: (ctx) =>
        defaultPlayActive(ctx) &&
        (ctx.view.players[ctx.perspectiveIdx]?.hand?.some((c) => c.name === '铁索连环') ??
          false),
    };
  }

  /** activeWhen 检查 view.players[0].hand,需在视图中设置手牌 */
  function makeChainView(opts: { currentPlayerIndex?: number } = {}): GameView {
    const view = makePlayView({ currentPlayerIndex: opts.currentPlayerIndex });
    view.players[0].hand = [CHAIN_CARD];
    return view;
  }

  it('选中铁索连环后 altActions 含 recast(替代出牌按钮可见)', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makeChainView(),
        skillActions: [chainUseAction(), chainRecastAction()],
        perspectiveHand: [CHAIN_CARD],
      }),
    );
    act(() => result.current.handleCardClick(CHAIN_CARD));
    expect(result.current.altActions).toHaveLength(1);
    expect(result.current.altActions[0].actionType).toBe('recast');
    expect(result.current.altActions[0].label).toBe('铁索连环·重铸');
  });

  it('未选牌时 altActions 为空', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [chainUseAction(), chainRecastAction()],
        perspectiveHand: [CHAIN_CARD],
      }),
    );
    expect(result.current.altActions).toEqual([]);
  });

  it('点击 recast 按钮发送 recast action(useCard 参数)', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makeChainView(),
        skillActions: [chainUseAction(), chainRecastAction()],
        perspectiveHand: [CHAIN_CARD],
        send,
      }),
    );
    act(() => result.current.handleCardClick(CHAIN_CARD));
    // 点击重铸按钮 → handleSkillAction(recastAction)
    const recastAction = result.current.altActions[0];
    expect(recastAction).toBeDefined();
    act(() => result.current.handleSkillAction(recastAction));
    expect(sentCalls(send)).toEqual([
      {
        skillId: '铁索连环',
        actionType: 'recast',
        params: { cardId: 'c-chain', cardIds: ['c-chain'] },
      },
    ]);
  });

  it('非自己回合时 recast 不 active,altActions 为空', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makeChainView({ currentPlayerIndex: 1 }),
        skillActions: [chainUseAction(), chainRecastAction()],
        perspectiveHand: [CHAIN_CARD],
      }),
      false,
    );
    act(() => result.current.handleCardClick(CHAIN_CARD));
    expect(result.current.altActions).toEqual([]);
  });

  it('非铁索连环牌不产生 altActions', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePlayView(),
        skillActions: [killUseAction(), chainRecastAction()],
        perspectiveHand: [KILL_CARD],
      }),
    );
    act(() => result.current.handleCardClick(KILL_CARD));
    expect(result.current.altActions).toEqual([]);
  });

  // Bug:选中桃后多出"出桃"/"火攻"按钮。根因 findAltActionsForCard 未排除 respond 类 action,
  // 将桃.respond(标签"出桃")、火攻.respond(标签"火攻", cardFilter 全匹配)误当替代出牌方式。
  it('选中桃后 altActions 不含 respond 类 action(出桃/火攻按钮不再多出)', () => {
    const peachRespond: SkillActionDef = {
      skillId: '桃',
      ownerId: 0,
      actionType: 'respond',
      label: '出桃',
      prompt: { type: 'useCard', title: '出桃救援', cardFilter: { filter: (c) => c.name === '桃', min: 1, max: 1 } },
    };
    const fireRespond: SkillActionDef = {
      skillId: '火攻',
      ownerId: 0,
      actionType: 'respond',
      label: '火攻',
      prompt: { type: 'useCard', title: '火攻', cardFilter: { filter: () => true, min: 1, max: 1 } },
    };
    const view = makePlayView();
    view.players[0].hand = [PEACH_CARD];
    const { result } = renderPlay(
      makePlayParams({
        view,
        skillActions: [peachUseAction(), peachRespond, fireRespond],
        perspectiveHand: [PEACH_CARD],
      }),
    );
    act(() => result.current.handleCardClick(PEACH_CARD));
    expect(result.current.altActions).toEqual([]);
  });
});

// ─── Bug 4: 桃满血时不可出 ───
// 桃 use action 添加 activeWhen: 满血时返回 false,阻止出牌按钮渲染。

describe('usePlayInteraction · 桃满血限制(activeWhen)', () => {
  /** 与 engine/skills/桃.ts onMount 声明同源的 activeWhen */
  function peachHealthActiveWhen(ctx: {
    view: GameView;
    perspectiveIdx: number;
  }): boolean {
    if (!defaultPlayActive(ctx)) return false;
    const p = ctx.view.players[ctx.perspectiveIdx];
    return p ? p.health < p.maxHealth : false;
  }

  /** 带满血限制的桃 use action */
  function peachUseActionWithHealthCheck(ownerId = 0): SkillActionDef {
    return {
      skillId: '桃',
      ownerId,
      actionType: 'use',
      label: '桃',
      style: 'primary',
      prompt: {
        type: 'useCardAndTarget',
        title: '使用桃',
        cardFilter: { filter: (c) => c.name === '桃', min: 1, max: 1 },
        selfTarget: true,
        targetFilter: { min: 1, max: 1 },
      },
      activeWhen: peachHealthActiveWhen,
    };
  }

  /** 可配置 P0 体力/体力的视图 */
  function makePeachView(opts: { health?: number; maxHealth?: number } = {}): GameView {
    const view = makePlayView();
    view.players[0].health = opts.health ?? 4;
    view.players[0].maxHealth = opts.maxHealth ?? 4;
    return view;
  }

  it('满血时桃 use action 不 active,出牌按钮不渲染', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePeachView({ health: 4, maxHealth: 4 }),
        skillActions: [peachUseActionWithHealthCheck()],
        perspectiveHand: [PEACH_CARD],
      }),
    );
    act(() => result.current.handleCardClick(PEACH_CARD));
    // selectedActive=false → 出牌按钮条件不满足(GameView 渲染需 selectedActive && playButtonState)
    expect(result.current.selectedActive).toBe(false);
  });

  it('受伤时桃 use action 正常 active,可出牌', () => {
    const { result } = renderPlay(
      makePlayParams({
        view: makePeachView({ health: 2, maxHealth: 4 }),
        skillActions: [peachUseActionWithHealthCheck()],
        perspectiveHand: [PEACH_CARD],
      }),
    );
    act(() => result.current.handleCardClick(PEACH_CARD));
    expect(result.current.selectedActive).toBe(true);
    expect(result.current.playButtonState).toEqual({ canPlay: true, targetLabel: '' });
  });

  it('满血时出桃后端不被调用(无 send 调用)', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePeachView({ health: 4, maxHealth: 4 }),
        skillActions: [peachUseActionWithHealthCheck()],
        perspectiveHand: [PEACH_CARD],
        send,
      }),
    );
    act(() => result.current.handleCardClick(PEACH_CARD));
    // 满血时 selectedActive=false → handlePlayCard 早退(use action 不 active)
    act(() => result.current.handlePlayCard());
    expect(send).not.toHaveBeenCalled();
  });

  it('受伤时出桃正常发送 use action', () => {
    const send = vi.fn();
    const { result } = renderPlay(
      makePlayParams({
        view: makePeachView({ health: 2, maxHealth: 4 }),
        skillActions: [peachUseActionWithHealthCheck()],
        perspectiveHand: [PEACH_CARD],
        send,
      }),
    );
    act(() => result.current.handleCardClick(PEACH_CARD));
    act(() => result.current.handlePlayCard());
    expect(sentCalls(send)).toEqual([
      { skillId: '桃', actionType: 'use', params: { cardId: 'c-peach', targets: [0] } },
    ]);
  });
});
