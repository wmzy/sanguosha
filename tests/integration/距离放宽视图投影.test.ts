// tests/integration/距离放宽视图投影.test.ts
// 契约:引擎放宽了距离/攻击范围(距离豁免器 / 攻击范围豁免器),view 层必须同样放宽——
// 否则浏览器选目标 UI(viewCanAttack → 座位置灰)与无头/AI 枚举
// (targetFilter 用 viewEffectiveDistance)都按默认距离判定,玩家/AI 无法选中
// 引擎明明允许的目标,整类效果在客户端不可用。
//
// 覆盖(修复前 view 侧距离仍按默认座位距离,与引擎不一致):
//   1. 天义(拼点赢后攻击范围无限)  2. 雄乱(本回合对其使用牌无距离限制)
//   3. 决堰·坐骑栏(本回合使用牌无距离限制)  4. 往烈(本回合首张牌无距离限制)
import { describe, it, expect, beforeEach } from 'vitest';
import { buildView } from '../../src/engine/index';
import { effectiveDistance, inAttackRange } from '../../src/engine/rules/distance';
import { viewCanAttack, viewEffectiveDistance } from '../../src/engine/rules/viewDistance';
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
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['回合管理'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 断言:view 侧距离/攻击范围与引擎一致(前端不得比引擎更严) */
function expectDistanceViewAgreesWithEngine(state: GameState, from: number, to: number): void {
  const view = buildView(state, from);
  expect(
    viewEffectiveDistance(view.players, from, to),
    `view 距离应为 ${String(effectiveDistance(state, from, to))}`,
  ).toBe(effectiveDistance(state, from, to));
  expect(viewCanAttack(view.players, from, to), 'view 应允许对该目标出杀').toBe(
    inAttackRange(state, from, to),
  );
}

describe('距离 / 攻击范围放宽必须投影到 view', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('天义:拼点赢后 view 侧攻击范围无限(与引擎一致)', async () => {
    const big = mkCard('c1', '杀', '♥', 'K');
    const small = mkCard('c2', '闪', '♠', '2');
    const state = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['回合管理', '天义'] }),
        mkPlayer({ index: 1, name: 'P1', hand: ['c2'] }),
        // 座次 2 距离 2,徒手范围 1 打不到 —— 天义赢后应可指定
        mkPlayer({ index: 2, name: 'P2' }),
        mkPlayer({ index: 3, name: 'P3' }),
      ],
      cardMap: { c1: big, c2: small },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    expect(inAttackRange(state, 0, 2)).toBe(false); // 前提:默认打不到座次 2

    await harness.player('P0').triggerAction('天义', 'use', { cardId: 'c1', target: 1 });
    await harness.waitForStable();
    await harness.player('P1').respond('天义', { cardId: 'c2' });
    await harness.waitForStable();

    expect(state.turn.vars['天义/win']).toBe(0);
    expect(inAttackRange(state, 0, 2)).toBe(true); // 引擎:攻击范围无限
    expectDistanceViewAgreesWithEngine(state, 0, 2);
  });

  it('雄乱:发动后 view 侧对其使用牌无距离限制(与引擎一致)', async () => {
    const state = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', skills: ['回合管理', '雄乱'] }),
        mkPlayer({ index: 1, name: 'P1' }),
        mkPlayer({ index: 2, name: 'P2' }),
        mkPlayer({ index: 3, name: 'P3' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').triggerAction('雄乱', 'use', { target: 2 });
    await harness.waitForStable();

    expect(effectiveDistance(state, 0, 2)).toBe(1);
    expectDistanceViewAgreesWithEngine(state, 0, 2);
    // 未被指定的目标不受影响
    expectDistanceViewAgreesWithEngine(state, 0, 1);
  });

  it('决堰·坐骑栏:view 侧本回合使用牌无距离限制(与引擎一致)', async () => {
    const state = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', skills: ['回合管理', '决堰'] }),
        mkPlayer({ index: 1, name: 'P1' }),
        mkPlayer({ index: 2, name: 'P2' }),
        mkPlayer({ index: 3, name: 'P3' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').triggerAction('决堰', 'use', { option: '坐骑' });
    await harness.waitForStable();

    expect(effectiveDistance(state, 0, 2)).toBe(1);
    expectDistanceViewAgreesWithEngine(state, 0, 2);
  });

  it('往烈:本回合首张牌无距离限制,view 侧一致(首张用出后恢复)', async () => {
    const card = mkCard('c1', '过河拆桥', '♣', '3', '锦囊牌');
    const state = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['回合管理', '往烈', '过河拆桥'] }),
        // 过河拆桥需目标有牌可弃
        mkPlayer({ index: 1, name: 'P1', hand: ['d1'] }),
        mkPlayer({ index: 2, name: 'P2' }),
        mkPlayer({ index: 3, name: 'P3' }),
      ],
      cardMap: { c1: card, d1: mkCard('d1', '杀', '♠', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    // 出牌阶段开始(真实对局由 回合管理 发 阶段开始 atom;往烈据此投影 view)
    const { applyAtom } = await import('../../src/engine/core/apply');
    await applyAtom(state, { type: '阶段开始', player: 0, phase: '出牌' });

    // 首张牌尚未使用:引擎视为距离 1(座次 2 距离 2 也放行)
    expect(effectiveDistance(state, 0, 2)).toBe(1);
    expectDistanceViewAgreesWithEngine(state, 0, 2);

    // 用出首张牌后,距离豁免失效 → 双方都恢复座位距离
    await harness.player('P0').useCardAndTarget('过河拆桥', 'c1', [1]);
    await harness.waitForStable();
    expect(effectiveDistance(state, 0, 2)).toBe(2);
    expectDistanceViewAgreesWithEngine(state, 0, 2);
  });
});

// ─── 挑衅/界挑衅:目标过滤必须是 inAttackRange(目标→姜维) 的投影 ───
// 挑衅目标语义:**目标**的杀能攻击到姜维(方向 目标→姜维,不是 姜维→目标)。
// 客户端 targetFilter 的旧实现是占位 `return true` → 枚举出打不到姜维的角色
// (4 人局座次 2 距离 2 > 徒手范围 1),玩家点了没反应 / AI 反复撞同一非法目标空转。
// 该修复此前零回归覆盖(改回占位整套测试不红),在此钉死「过滤结果 == 引擎判定」。
describe('挑衅目标过滤与引擎攻击范围一致', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it.each(['挑衅', '界挑衅'])(
    '%s:超出目标攻击范围的座次不得被选为目标(过滤与 inAttackRange 逐一一致)',
    async (skillId) => {
      const state = createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', skills: ['回合管理', skillId] }),
          mkPlayer({ index: 1, name: 'P1' }),
          // 座次 2 距离 2,徒手范围 1:其杀打不到 P0 → 不可被挑衅
          mkPlayer({ index: 2, name: 'P2' }),
          mkPlayer({ index: 3, name: 'P3' }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      });
      await harness.setup(state);

      // 引擎侧基准(方向:目标 → 姜维):邻座(1/3)能打到我,对座(2)打不到
      expect(inAttackRange(state, 1, 0)).toBe(true);
      expect(inAttackRange(state, 2, 0)).toBe(false);
      expect(inAttackRange(state, 3, 0)).toBe(true);
      // view 侧与引擎一致(同向使用:from=目标,to=姜维)
      for (const t of [1, 2, 3]) expectDistanceViewAgreesWithEngine(state, t, 0);

      // 客户端 targetFilter(挑衅 use 的 selectTarget prompt,与浏览器选目标 UI 同源)
      const session = harness.player('P0');
      const useAction = session
        .availableActions()
        .find((a) => a.skillId === skillId && a.actionType === 'use');
      expect(useAction, `${skillId}:use 应已注册到前端`).toBeDefined();
      const prompt = useAction!.prompt;
      expect(prompt.type).toBe('selectTarget');
      const filter = prompt.type === 'selectTarget' ? prompt.targetFilter?.filter : undefined;
      expect(filter, `${skillId}:use 应声明 targetFilter.filter`).toBeDefined();
      const view = session.view;
      expect([1, 2, 3].filter((t) => filter!(view, t))).toEqual([1, 3]); // 座次 2 不出现

      // 过滤结果与引擎判定逐一一致(占位 `return true` 会把座次 2 也放进来)
      for (const t of [1, 2, 3]) {
        expect(filter!(view, t), `座次 ${t} 的过滤结果应与引擎 inAttackRange 一致`).toBe(
          inAttackRange(state, t, 0),
        );
      }

      // 引擎权威印证:被过滤的座次 2 提交必拒,枚举出的座次 1 可提交
      expect(
        await session.tryDispatch({ skillId, actionType: 'use', params: { target: 2 } }),
        '座次 2 打不到姜维,引擎应拒',
      ).toBe(false);
      expect(
        await session.tryDispatch({ skillId, actionType: 'use', params: { target: 1 } }),
        '座次 1 打得到姜维,引擎应接受',
      ).toBe(true);
    },
  );
});
