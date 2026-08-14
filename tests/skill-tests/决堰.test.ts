// 陆抗(吴·风林火山 hero/414)技能测试:
//   决堰:废除装备栏 + 本回合对应效果(武器杀次数+3 / 防具摸牌+上限 / 坐骑无距离 / 宝物集智)
//   谦节:防连环 / 免疫延时锦囊 / 不能成为拼点目标 / 已废除槽不可装装备
//   破势:觉醒(装备全废 或 体力为1)→ 减上限 + 摸至上限 + 失决堰 + 得怀柔
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import * as 谦节Module from '../../src/engine/skills/谦节';
import * as 决堰Module from '../../src/engine/skills/决堰';
import * as 破势Module from '../../src/engine/skills/破势';
import { createGameState, suitColor } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import { slashMax } from '../../src/engine/rules/slash-quota';
import { handLimit } from '../../src/engine/rules/hand-limit';
import { isDistanceExempted } from '../../src/engine/rules/distance';
import type { Card, PlayerState } from '../../src/engine/types';

// 本地注册技能模块(主 agent 统一在 skills/index.ts 注册;测试本地兜底)
setSkillModuleOverride('谦节', async () => 谦节Module);
setSkillModuleOverride('决堰', async () => 决堰Module);
setSkillModuleOverride('破势', async () => 破势Module);

const ABOLISH_PREFIX = '决堰/废除:';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  subtype?: string,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type, subtype };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: PlayerState['equipment'];
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '陆抗',
    health: opts.health ?? opts.maxHealth ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: (opts.vars as PlayerState['vars']) ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 构建标准测试 state:P0=陆抗(满血4/4),P1=敌方,出牌阶段 */
function makeLuKangState(opts?: {
  p0Hand?: string[];
  p0Equipment?: PlayerState['equipment'];
  p0Vars?: Record<string, unknown>;
  p0Health?: number;
  extraCards?: Record<string, Card>;
  playerCount?: number;
}) {
  const n = opts?.playerCount ?? 2;
  const players: PlayerState[] = [
    makePlayer({
      index: 0,
      name: '陆抗',
      hand: opts?.p0Hand ?? [],
      skills: ['谦节', '决堰', '破势'],
      health: opts?.p0Health,
      maxHealth: 4,
      equipment: opts?.p0Equipment,
      vars: opts?.p0Vars,
    }),
  ];
  for (let i = 1; i < n; i++) {
    players.push(makePlayer({ index: i, name: `P${i}`, hand: [] }));
  }
  const cardMap: Record<string, Card> = {
    ...(opts?.extraCards ?? {}),
  };
  return createGameState({
    players,
    cardMap,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('决堰', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 武器栏:杀限制次数+3 ───────────────────
  it('废除武器栏 → 本回合杀次数+3(slashMax=4)', async () => {
    const state = makeLuKangState();
    await harness.setup(state);
    const P0 = harness.player('陆抗');

    // 废除前:基础杀次数 1
    expect(slashMax(harness.state, 0)).toBe(1);

    await P0.triggerAction('决堰', 'use', { slot: '武器' });

    // 废除后:1 + 3 = 4
    expect(slashMax(harness.state, 0)).toBe(4);
    // 废除标记
    expect(harness.state.players[0].vars[`${ABOLISH_PREFIX  }武器`]).toBe(true);
  });

  // ─── 防具栏:摸三张 + 手牌上限+3 ───────────────
  it('废除防具栏 → 摸三张牌且手牌上限+3', async () => {
    const state = makeLuKangState({ p0Hand: ['c0'] });
    await harness.setup(state);
    const P0 = harness.player('陆抗');

    const beforeHand = harness.state.players[0].hand.length;
    expect(handLimit(harness.state, 0)).toBe(4); // health=4, no bonus

    await P0.triggerAction('决堰', 'use', { slot: '防具' });

    expect(harness.state.players[0].hand.length).toBe(beforeHand + 3); // 摸了 3 张
    expect(handLimit(harness.state, 0)).toBe(7); // 4 + 3
    expect(harness.state.players[0].vars[`${ABOLISH_PREFIX  }防具`]).toBe(true);
  });

  // ─── 坐骑栏:使用牌无距离限制 ─────────────────
  it('废除坐骑栏 → 本回合使用牌无距离限制(距离豁免)', async () => {
    // 4 人座,P0 与 P3 距离最远
    const state = makeLuKangState({ playerCount: 4 });
    await harness.setup(state);
    const P0 = harness.player('陆抗');

    // 废除前:P0→P3 距离不豁免
    expect(isDistanceExempted(harness.state, 0, 3)).toBe(false);

    await P0.triggerAction('决堰', 'use', { slot: '坐骑' });

    // 废除后:P0→任意目标距离豁免
    expect(isDistanceExempted(harness.state, 0, 1)).toBe(true);
    expect(isDistanceExempted(harness.state, 0, 3)).toBe(true);
    // 进攻马 + 防御马 均废除
    expect(harness.state.players[0].vars[`${ABOLISH_PREFIX  }进攻马`]).toBe(true);
    expect(harness.state.players[0].vars[`${ABOLISH_PREFIX  }防御马`]).toBe(true);
  });

  // ─── 宝物栏:获得集智(回合结束移除) ──────────
  it('废除宝物栏 → 获得集智,回合结束后失去集智', async () => {
    const state = makeLuKangState();
    await harness.setup(state);
    const P0 = harness.player('陆抗');

    expect(harness.state.players[0].skills.includes('集智')).toBe(false);

    await P0.triggerAction('决堰', 'use', { slot: '宝物' });

    // 获得集智
    expect(harness.state.players[0].skills.includes('集智')).toBe(true);
    expect(harness.state.players[0].vars[`${ABOLISH_PREFIX  }宝物`]).toBe(true);

    // 回合结束 → 集智移除
    await applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].skills.includes('集智')).toBe(false);
  });

  // ─── 限一次 ──────────────────────────────
  it('出牌阶段限一次:同回合第二次决堰被拒绝', async () => {
    const state = makeLuKangState();
    await harness.setup(state);
    const P0 = harness.player('陆抗');

    await P0.triggerAction('决堰', 'use', { slot: '武器' });
    // 第二次:不同栏也应被拒(限一次是整局技能,非每栏一次)
    await P0.expectRejected({ skillId: '决堰', actionType: 'use', params: { slot: '防具' } });
  });

  // ─── 已废除的栏不能再次废除 ─────────────────
  it('已全部废除的栏不可再选', async () => {
    const state = makeLuKangState();
    await harness.setup(state);
    const P0 = harness.player('陆抗');

    await P0.triggerAction('决堰', 'use', { slot: '武器' });
    // 清除限一次标记,单独验证"已废除的栏不可再选"逻辑(canAbolishGroup)
    delete harness.state.players[0].vars['决堰/usedThisTurn'];
    await P0.expectRejected({ skillId: '决堰', actionType: 'use', params: { slot: '武器' } });
    // 负面对照:未废除的防具栏仍可选
    await P0.expectAccepted({ skillId: '决堰', actionType: 'use', params: { slot: '防具' } });
  });
});

describe('谦节', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 防连环 ──────────────────────────────
  it('进入连环状态 → 防止之(不获得 chained 标记)', async () => {
    const state = makeLuKangState();
    await harness.setup(state);

    await applyAtom(harness.state, { type: '设横置', player: 0, chained: true });
    await harness.waitForStable();

    expect(harness.state.players[0].marks.some((m) => m.id === 'chained')).toBe(false);
  });

  it('负面:非谦节角色可正常进入连环', async () => {
    const state = makeLuKangState();
    await harness.setup(state);

    await applyAtom(harness.state, { type: '设横置', player: 1, chained: true });
    await harness.waitForStable();

    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
  });

  // ─── 免疫延时锦囊 ─────────────────────────
  it('成为延时锦囊目标 → 不放入判定区(免疫)', async () => {
    const state = makeLuKangState({
      extraCards: { lt: makeCard('lt', '乐不思蜀', '♠', '6', '锦囊牌') },
    });
    await harness.setup(state);

    await applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '乐不思蜀', source: 1, card: harness.state.cardMap['lt'] },
    });
    await harness.waitForStable();

    expect(harness.state.players[0].pendingTricks.length).toBe(0);
  });

  it('负面:非谦节角色可被放延时锦囊', async () => {
    const state = makeLuKangState({
      extraCards: { lt: makeCard('lt', '乐不思蜀', '♠', '6', '锦囊牌') },
    });
    await harness.setup(state);

    await applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 1,
      trick: { name: '乐不思蜀', source: 0, card: harness.state.cardMap['lt'] },
    });
    await harness.waitForStable();

    expect(harness.state.players[1].pendingTricks.length).toBe(1);
  });

  // ─── 不能成为拼点目标 ─────────────────────
  it('成为拼点目标 → 拼点选牌请求被取消(不创建 pending)', async () => {
    const state = makeLuKangState();
    await harness.setup(state);

    // 模拟天义发起的拼点选牌请求(请求回应 requestType='天义/拼点')
    await applyAtom(harness.state, {
      type: '请求回应',
      requestType: '天义/拼点',
      target: 0,
      prompt: { type: 'useCard', title: '拼点', cardFilter: { min: 1, max: 1 } },
      timeout: 30,
    });
    await harness.waitForStable();

    // 谦节 cancel → 不创建 pending slot
    expect(harness.state.pendingSlots.has(0)).toBe(false);
  });

  // ─── 已废除的槽不可装装备 ─────────────────
  it('已废除的装备栏不可装备(谦节拦截)', async () => {
    const state = makeLuKangState({
      p0Hand: ['w1'],
      p0Vars: { [`${ABOLISH_PREFIX  }武器`]: true },
      extraCards: { w1: makeCard('w1', '诸葛连弩', '♣', 'A', '装备牌', '武器') },
    });
    await harness.setup(state);

    // 尝试装备武器到已废除的武器栏
    await applyAtom(harness.state, { type: '装备', player: 0, cardId: 'w1' });
    await harness.waitForStable();

    // 被谦节 cancel:装备未装入,牌仍在手牌
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.players[0].hand.includes('w1')).toBe(true);
  });
});

describe('破势', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 装备栏均被废除 → 觉醒 ─────────────────
  it('装备栏均被废除 → 减上限 + 摸至上限 + 失决堰 + 得怀柔', async () => {
    // P0 手牌 1 张,体力 4/4,5 个装备槽全部废除
    const state = makeLuKangState({
      p0Hand: ['c0'],
      p0Vars: Object.fromEntries(
        (['武器', '防具', '进攻马', '防御马', '宝物'] as const).map((s) => [
          ABOLISH_PREFIX + s,
          true,
        ]),
      ),
    });
    await harness.setup(state);

    // 触发准备阶段
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    harness.processAllEvents();

    const p0 = harness.state.players[0];
    expect(p0.vars['破势/awakened']).toBe(true); // 觉醒标记
    expect(p0.maxHealth).toBe(3); // 4 - 1
    expect(p0.hand.length).toBe(3); // 摸至体力上限 3(原有1 + 摸2)
    expect(p0.skills.includes('决堰')).toBe(false); // 失去决堰
    expect(p0.skills.includes('怀柔')).toBe(true); // 获得怀柔(未注册但仍加入 skills)
  });

  // ─── 体力值为1 → 觉醒 ─────────────────────
  it('体力值为1(装备栏未全废)→ 觉醒', async () => {
    const state = makeLuKangState({ p0Health: 1 });
    await harness.setup(state);

    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    harness.processAllEvents();

    const p0 = harness.state.players[0];
    expect(p0.vars['破势/awakened']).toBe(true);
    expect(p0.maxHealth).toBe(3); // 4 - 1
    // 手牌摸至 3(原本0 + 摸3)
    expect(p0.hand.length).toBe(3);
  });

  // ─── 条件不满足 → 不觉醒 ───────────────────
  it('装备栏未全废且体力>1 → 不觉醒', async () => {
    const state = makeLuKangState({ p0Health: 4 });
    await harness.setup(state);

    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    expect(harness.state.players[0].vars['破势/awakened']).toBeUndefined();
    expect(harness.state.players[0].maxHealth).toBe(4);
  });

  // ─── 整局一次 ────────────────────────────
  it('已觉醒后不再触发(整局一次)', async () => {
    const state = makeLuKangState({
      p0Health: 1,
      p0Vars: { '破势/awakened': true },
    });
    await harness.setup(state);

    const maxBefore = harness.state.players[0].maxHealth;
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    // 已觉醒 → 不再减上限
    expect(harness.state.players[0].maxHealth).toBe(maxBefore);
  });
});
