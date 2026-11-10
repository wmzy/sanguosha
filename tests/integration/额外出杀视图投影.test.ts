// tests/integration/额外出杀视图投影.test.ts
// 契约:引擎放宽了出杀次数上限(额外出杀 / 无次数限制),view 层必须同样放宽——
// 否则浏览器「杀」按钮(activeWhen → viewCanSlash)与无头/AI 枚举
// (isActiveAction → 同一 activeWhen)都按默认上限 1 判定,玩家/ AI 无法使用
// 引擎明明允许的第 2、3 张杀,整类效果在客户端不可用。
//
// 判定口径(view 层读 turnUsage 通用前缀):
//   '杀/extra/<来源>'     数字 → 叠加到上限(viewSlashMax)
//   '杀/unlimited/<来源>' 真值 → 上限 ∞
// 技能在写 state.turn.vars 之后必须用「回合用量」atom 同步同名 key 到 view。
//
// 覆盖(修复前 view 侧上限恒为 1,与引擎不一致):
//   1. 雄乱(无次数限制)  2. 界陷阵拼点赢(无次数限制)
//   3. 界鞬出非基本分支(+1)  4. 立军主公确认(盟友 +1)
//   5. 非当前回合玩家写入 杀/extra(界鞬出 被 借刀杀人/挑衅 逼杀):
//      __view 镜像不得归属到当前回合玩家(buildView 只投影给 currentPlayerIndex)
import { describe, it, expect, beforeEach } from 'vitest';
import { buildView } from '../../src/engine/index';
import { canSlash, slashMax } from '../../src/engine/rules/slash-quota';
import { viewCanSlash, viewSlashMax } from '../../src/engine/rules/action-active';
import { SLASH_USED_COUNT_KEY, slashExtraKey } from '../../src/engine/rules/vars-keys';
import { applyAtom } from '../../src/engine/core/apply';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: Card['suit'] = '♠',
  rank = '7',
  type: Card['type'] = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♥' || suit === '♦' ? '红' : '黑', rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  faction?: PlayerState['faction'];
  equipment?: Record<string, string>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    faction: opts.faction,
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['回合管理'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 模拟「本回合已出过 1 张杀」:state 侧计数 + view 侧投影(与 杀.onSettle 同构) */
async function markOneSlashUsed(state: GameState, seat: number): Promise<void> {
  state.turn.vars['杀/quotaUsed'] = 1;
  await applyAtom(state, {
    type: '回合用量',
    player: seat,
    key: SLASH_USED_COUNT_KEY,
    value: 1,
  });
}

/** 断言:view 侧与引擎侧对「还能不能出杀」的判断一致 */
function expectViewAgreesWithEngine(state: GameState, seat: number): void {
  const view = buildView(state, seat);
  expect(
    viewSlashMax(view, seat),
    `view 出杀上限应为 ${String(slashMax(state, seat))}`,
  ).toBe(slashMax(state, seat));
  expect(viewCanSlash(view, seat), 'view 应允许继续出杀').toBe(canSlash(state, seat, undefined));
}

describe('额外出杀 / 无次数限制必须投影到 view', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('雄乱:发动后 view 侧出杀无次数限制(与引擎一致)', async () => {
    const state = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', skills: ['回合管理', '雄乱'] }),
        mkPlayer({ index: 1, name: 'P1' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').triggerAction('雄乱', 'use', { target: 1 });
    await harness.waitForStable();
    expect(slashMax(state, 0)).toBe(Infinity);

    // 已出过 1 张杀后,引擎仍允许继续出杀 —— view 也必须如此
    await markOneSlashUsed(state, 0);
    expectViewAgreesWithEngine(state, 0);
  });

  it('界陷阵:只对拼点目标免次数,view仍提供出杀入口', async () => {
    const big = mkCard('c1', '杀', '♥', 'K');
    const small = mkCard('c2', '闪', '♠', '2');
    const state = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['回合管理', '界陷阵'] }),
        mkPlayer({ index: 1, name: 'P1', hand: ['c2'] }),
      ],
      cardMap: { c1: big, c2: small },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').triggerAction('界陷阵', 'use', { cardId: 'c1', target: 1 });
    await harness.waitForStable();
    await harness.player('P1').respond('界陷阵', { cardId: 'c2' });
    await harness.waitForStable();

    expect(state.turn.vars['陷阵/winTarget']).toBe(1);
    expect(slashMax(state, 0)).toBe(1);
    await markOneSlashUsed(state, 0);
    const view = buildView(state, 0);
    expect(viewSlashMax(view, 0)).toBe(1);
    expect(viewCanSlash(view, 0)).toBe(true);
    expect(canSlash(state, 0, undefined, [1])).toBe(true);
    expect(canSlash(state, 0, undefined, [0])).toBe(false);
  });

  it('界鞬出:非基本牌分支 +1 后 view 侧出杀上限与引擎一致', async () => {
    const slash = mkCard('k1', '杀', '♠', '8');
    const trick = mkCard('x1', '过河拆桥', '♣', '3', '锦囊牌');
    const state = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['回合管理', '杀', '界鞬出'] }),
        mkPlayer({ index: 1, name: 'P1', hand: ['x1'] }),
      ],
      cardMap: { k1: slash, x1: trick },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').useCardAndTarget('杀', 'k1', [1]);
    await harness.waitForStable();
    // 界庞德确认发动鞬出
    await harness.player('P0').respond('界鞬出', { choice: true });
    await harness.waitForStable();
    // 目标自选弃一张非基本牌(锦囊)→ 本回合出杀次数 +1
    await harness.player('P1').respond('界鞬出', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();

    expect(state.turn.vars['界鞬出/quotaBonus']).toBe(1);
    expect(slashMax(state, 0)).toBe(2);
    expectViewAgreesWithEngine(state, 0);
  });

  it('立军:主公确认后盟友 view 侧出杀上限与引擎一致', async () => {
    const slash = mkCard('k1', '杀', '♠', '9');
    const state = createGameState({
      players: [
        // 座次 0 = 主公位(立军主公技条件)
        mkPlayer({ index: 0, name: '孙亮', skills: ['回合管理', '立军'] }),
        mkPlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['回合管理', '杀'], faction: '吴' }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 盟友用杀 → 立军触发(问盟友是否交给主公 → 问主公是否令其摸牌+杀次+1)
    await harness.player('P1').useCardAndTarget('杀', 'k1', [0]);
    await harness.waitForStable();
    await harness.player('P1').respond('立军', { choice: true });
    await harness.waitForStable();
    await harness.player('孙亮').respond('立军', { choice: true });
    await harness.waitForStable();

    expect(slashMax(state, 1)).toBe(2);
    await markOneSlashUsed(state, 1);
    expectViewAgreesWithEngine(state, 1);
  });

  it('非当前回合玩家写入 杀/extra:__view 镜像不得归属到当前回合玩家(界鞬出被逼杀)', async () => {
    // 场景:界庞德(座次1)在 P0 的回合被 借刀杀人/挑衅 指定对他人出杀——界鞬出 的
    // 指定目标 after-hook 只看 atom.source === ownerId(与谁的回合无关),非基本牌分支
    // 以 player:1 写 '杀/extra/界鞬出'。turn.vars 的 __view 镜像键不含玩家维度,而
    // buildView 只把 __view/* 投影给 state.currentPlayerIndex → 镜像会把 +1 错记到
    // P0 头上:重连后 P0 viewSlashMax=2 ≠ 引擎 1,客户端枚举的第 2 张杀必被引擎拒。
    const state = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', skills: ['回合管理'] }),
        mkPlayer({ index: 1, name: '界庞德', skills: ['回合管理', '界鞬出'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 界鞬出 非基本分支的 state 侧真相 + view 投影(与 askTargetToDiscard 同构),
    // 写入方是非当前回合玩家(界庞德,座次1)
    state.turn.vars['界鞬出/quotaBonus'] = 1;
    await applyAtom(state, {
      type: '回合用量',
      player: 1,
      key: slashExtraKey('界鞬出'),
      value: 1,
    });

    // 引擎侧:+1 只属于界庞德(provider 按 ownerId 归属),当前回合玩家 P0 上限仍为 1
    expect(slashMax(state, 1)).toBe(2);
    expect(slashMax(state, 0)).toBe(1);

    // (a) buildView 重建(初始/重连视图):P0 的 view 出杀上限不得被镜像抬高
    const view = buildView(state, 0);
    expect(viewSlashMax(view, 0)).toBe(1);
    expectViewAgreesWithEngine(state, 0);

    // (b) 在线增量路径不受镜像守卫影响:事件按 event.player 归属界庞德
    harness.processAllEvents();
    const jpView = harness.player('界庞德').processedView;
    expect(
      jpView.players.find((p) => p.index === 1)?.turnUsage?.[slashExtraKey('界鞬出')],
    ).toBe(1);
  });
});
