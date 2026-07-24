// tests/skill-tests/使用牌.test.ts
// 使用牌/打出牌核心技能测试 + CardEffect 注册表 + 合法性检测 + runUseFlow / runPlayFlow 编排
//
// 测试分层：
//   1. CardEffect 注册表（register/get/has/require）— 纯函数，不需引擎
//   2. 合法性检测（isLegalTarget / findLegalTargets / validateCardUse）— 纯函数，raw state 即可
//   3. runUseFlow 编排流程 — 需 harness 初始化 state（牌堆/hook/注册表）
//   4. runPlayFlow 编排流程 — 需 harness 初始化 state
//
// 注册的测试牌效果一律用唯一牌名（测试杀/测试顺/...），避免与正式技能注册的
// CardEffect 冲突（注册表为模块级全局 Map）。

import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import { applyAtom, frameCards, pushFrame, popFrame } from '../../src/engine/create-engine';
import { runDamageFlow } from '../../src/engine/damage-flow';
import {
  registerCardEffect,
  getCardEffect,
  hasCardEffect,
  requireCardEffect,
} from '../../src/engine/card-effect/registry';
import type { CardEffect } from '../../src/engine/card-effect/registry';
import {
  isLegalTarget,
  findLegalTargets,
  validateCardUse,
} from '../../src/engine/card-effect/validate';
import { runUseFlow } from '../../src/engine/card-effect/use-card';
import { runPlayFlow } from '../../src/engine/card-effect/play-card';

// ─── 测试用牌效果（模块级，只注册一次） ──────────────────────

// 测试杀：inAttackRange 目标；resolve 询问闪 → 处理区无闪则造成伤害（对齐真实 杀 结算）
const 测试杀Effect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'inAttackRange', min: 1, max: 1 },
  resolve: async (ctx) => {
    const { state, source, target, cardId } = ctx;
    await applyAtom(state, { type: '询问闪', target, source });
    const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (dodgeIds.length === 0) {
      await runDamageFlow(state, source, target, 1, cardId);
    }
  },
  prompt: {
    type: 'useCardAndTarget',
    title: '测试杀',
    cardFilter: { filter: (c: Card) => c.name === '测试杀', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  },
  label: '测试杀',
  style: 'danger',
};

// 距离 1 内（对齐 顺手牵羊），2 人相邻 → 目标合法
const 测试顺Effect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'distance', dist: 1, min: 1, max: 1 },
  resolve: async () => {},
  prompt: {
    type: 'useCardAndTarget',
    title: '测试顺',
    cardFilter: { min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  },
  label: '测试顺',
  style: 'primary',
};

// 距离 0 内 → 2 人距离 1 > 0，目标不合法（测试「超出距离」分支）
const 测试近Effect: CardEffect = {
  ...测试顺Effect,
  target: { kind: 'distance', dist: 0, min: 1, max: 1 },
  label: '测试近',
};

// self：只能指定自己
const 测试自Effect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'self' },
  resolve: async () => {},
  prompt: { type: 'useCard', title: '测试自', cardFilter: { min: 1, max: 1 } },
  label: '测试自',
  style: 'default',
};

// self：目标是自己（如无中生有）
const 测试无Effect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'self' },
  resolve: async () => {},
  prompt: { type: 'useCard', title: '测试无', cardFilter: { min: 1, max: 1 } },
  label: '测试无',
  style: 'default',
};

// effect：目标是效果而非玩家（如闪/无懈可击）
const 测试效Effect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'effect' },
  resolve: async () => {},
  prompt: { type: 'useCard', title: '测试效', cardFilter: { min: 1, max: 1 } },
  label: '测试效',
  style: 'default',
};

// wounded：只能指定已受伤角色
const 测试伤Effect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'wounded', min: 0, max: 1 },
  resolve: async () => {},
  prompt: {
    type: 'useCardAndTarget',
    title: '测试伤',
    cardFilter: { min: 1, max: 1 },
    targetFilter: { min: 0, max: 1 },
  },
  label: '测试伤',
  style: 'primary',
};

registerCardEffect('测试杀', 测试杀Effect);
registerCardEffect('测试顺', 测试顺Effect);
registerCardEffect('测试近', 测试近Effect);
registerCardEffect('测试自', 测试自Effect);
registerCardEffect('测试无', 测试无Effect);
registerCardEffect('测试效', 测试效Effect);
registerCardEffect('测试伤', 测试伤Effect);

// ─── helpers ───────────────────────────────────────────────

function makePlayer(opts: {
  index: number;
  name: string;
  hand: string[];
  skills: string[];
  health?: number;
}) {
  return {
    ...opts,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: 4,
    alive: true,
    equipment: {},
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeCard(id: string, name: string): Card {
  return { id, name, suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
}

function buildState(opts?: {
  p1Hand?: string[];
  p2Hand?: string[];
  p2Health?: number;
  extraCardMap?: Record<string, Card>;
}): GameState {
  const c1 = makeCard('c1', '测试杀');
  const c3: Card = { id: 'c3', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? ['c1'], skills: ['使用牌'] }),
      makePlayer({ index: 1, name: 'P2', hand: opts?.p2Hand ?? [], skills: [], health: opts?.p2Health }),
    ],
    cardMap: { c1, c3, ...opts?.extraCardMap },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

// ═══════════════════════════════════════════════════════════
// 1. CardEffect 注册表
// ═══════════════════════════════════════════════════════════

describe('CardEffect 注册表', () => {
  it('registerCardEffect + getCardEffect 正确存取', () => {
    registerCardEffect('注册表测试牌A', 测试无Effect);
    expect(getCardEffect('注册表测试牌A')).toBe(测试无Effect);
  });

  it('getCardEffect 未注册返回 undefined', () => {
    expect(getCardEffect('不存在的牌')).toBeUndefined();
  });

  it('hasCardEffect 正确判断已注册/未注册', () => {
    registerCardEffect('注册表测试牌B', 测试顺Effect);
    expect(hasCardEffect('注册表测试牌B')).toBe(true);
    expect(hasCardEffect('不存在的牌')).toBe(false);
    // 模块级注册的测试牌也应当可见
    expect(hasCardEffect('测试杀')).toBe(true);
  });

  it('requireCardEffect 已注册返回 effect', () => {
    registerCardEffect('注册表测试牌C', 测试杀Effect);
    expect(requireCardEffect('注册表测试牌C')).toBe(测试杀Effect);
  });

  it('requireCardEffect 未注册抛错', () => {
    expect(() => requireCardEffect('不存在的牌')).toThrow();
  });

  it('registerCardEffect 覆盖同名注册（幂等 set）', () => {
    registerCardEffect('注册表测试牌D', 测试无Effect);
    registerCardEffect('注册表测试牌D', 测试杀Effect);
    expect(getCardEffect('注册表测试牌D')).toBe(测试杀Effect);
  });
});

// ═══════════════════════════════════════════════════════════
// 2. 合法性检测 isLegalTarget / findLegalTargets / validateCardUse
// ═══════════════════════════════════════════════════════════

describe('合法性检测 isLegalTarget', () => {
  // 2 人局：P1(0) ↔ P2(1) 座位距离 1，默认攻击范围 1
  it('inAttackRange：攻击范围内的目标合法（测试杀 → P2）', () => {
    const state = buildState();
    expect(isLegalTarget(state, 0, '测试杀', 1)).toBe(true);
  });

  it('distance：距离内目标合法（测试顺 dist=1 → P2 距离 1）', () => {
    const state = buildState();
    expect(isLegalTarget(state, 0, '测试顺', 1)).toBe(true);
  });

  it('distance：超出距离的目标不合法（测试近 dist=0 → P2 距离 1 > 0）', () => {
    const state = buildState();
    expect(isLegalTarget(state, 0, '测试近', 1)).toBe(false);
  });

  it('effect：不能指定任何玩家目标（含自己）', () => {
    const state = buildState();
    expect(isLegalTarget(state, 0, '测试效', 1)).toBe(false);
    expect(isLegalTarget(state, 0, '测试效', 0)).toBe(false);
  });

  it('self：只能指定自己，不能指定他人', () => {
    const state = buildState();
    expect(isLegalTarget(state, 0, '测试自', 0)).toBe(true);
    expect(isLegalTarget(state, 0, '测试自', 1)).toBe(false);
  });

  it('wounded：满血角色不合法，受伤角色合法', () => {
    const full = buildState();
    expect(isLegalTarget(full, 0, '测试伤', 1)).toBe(false); // P2 满血
    const wounded = buildState({ p2Health: 2 });
    expect(isLegalTarget(wounded, 0, '测试伤', 1)).toBe(true); // P2 受伤
    expect(isLegalTarget(wounded, 0, '测试伤', 0)).toBe(false); // P1 满血
  });

  it('未注册 CardEffect 的牌：任何目标都不合法', () => {
    const state = buildState();
    expect(isLegalTarget(state, 0, '不存在的牌', 1)).toBe(false);
  });
});

describe('findLegalTargets', () => {
  it('返回全部合法目标', () => {
    const state = buildState();
    expect(findLegalTargets(state, 0, '测试杀')).toEqual([1]);
    expect(findLegalTargets(state, 0, '测试效')).toEqual([]);
    expect(findLegalTargets(state, 0, '测试自')).toEqual([0]);
  });

  it('受伤目标场景下 wounded 返回受伤角色', () => {
    const wounded = buildState({ p2Health: 2 });
    expect(findLegalTargets(wounded, 0, '测试伤')).toEqual([1]);
  });
});

describe('validateCardUse 统一合法性检测', () => {
  it('合法使用测试杀 → 返回 null（通过）', () => {
    const state = buildState();
    expect(validateCardUse(state, 0, { cardId: 'c1', targets: [1] }, '测试杀')).toBeNull();
  });

  it('不是自己回合 → 拒绝', () => {
    const state = buildState();
    state.currentPlayerIndex = 1;
    expect(validateCardUse(state, 0, { cardId: 'c1' }, '测试杀')).toBe('不是你的回合');
  });

  it('不是出牌阶段 → 拒绝', () => {
    const state = buildState();
    state.phase = '摸牌';
    expect(validateCardUse(state, 0, { cardId: 'c1' }, '测试杀')).toBe('不是出牌阶段');
  });

  it('牌名不匹配 → 拒绝', () => {
    const state = buildState();
    // c1 是 测试杀，却按 测试顺 校验
    expect(validateCardUse(state, 0, { cardId: 'c1' }, '测试顺')).toBe('不是测试顺');
  });

  it('无合法目标 → 拒绝（测试近 dist=0，全场无额定目标）', () => {
    const c9 = makeCard('c9', '测试近');
    const state = buildState({ p1Hand: ['c9'], extraCardMap: { c9 } });
    expect(validateCardUse(state, 0, { cardId: 'c9', targets: [1] }, '测试近')).toBe(
      '没有合法目标',
    );
  });

  it('被禁用 tag（义绝/禁出牌）→ 拒绝', () => {
    const state = buildState();
    state.players[0].tags.push('义绝/禁出牌');
    expect(validateCardUse(state, 0, { cardId: 'c1' }, '测试杀')).toBe('你不能使用此牌');
  });

  it('canUse 牌特有校验返回字符串 → 拒绝', () => {
    const 拒Effect: CardEffect = {
      ...测试无Effect,
      canUse: () => '自定义拒绝理由',
      label: '测试拒',
    };
    registerCardEffect('测试拒', 拒Effect);
    const c10 = makeCard('c10', '测试拒');
    const state = buildState({ p1Hand: ['c10'], extraCardMap: { c10 } });
    expect(validateCardUse(state, 0, { cardId: 'c10' }, '测试拒')).toBe('自定义拒绝理由');
  });
});

// ═══════════════════════════════════════════════════════════
// 3. runUseFlow 编排流程（直接调用，不经 action dispatch）
// ═══════════════════════════════════════════════════════════

describe('使用牌 runUseFlow', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('使用测试杀 → 目标不出闪（pass）→ 受伤 1 点，杀进弃牌堆', async () => {
    const state = buildState();
    await harness.setup(state);
    const P2 = harness.player('P2');

    // 直接调用 runUseFlow（不经 action 路由）：fire-and-forget，在 询问闪 pending 处挂起
    const flow = runUseFlow(state, 0, 'c1', [1], '测试杀');
    await harness.waitForStable(); // 询问闪 pending 出现
    await P2.pass(); // P2 不出闪 → 超时 resolve
    await flow; // runUseFlow 结算完毕

    expect(state.players[1].health).toBe(3);
    expect(state.zones.discardPile).toContain('c1');
  });

  it('atom 事件流包含完整使用结算时机（子序列）', async () => {
    const state = buildState();
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const flow = runUseFlow(state, 0, 'c1', [1], '测试杀');
    await harness.waitForStable();
    await P2.pass();
    await flow;
    harness.processAllEvents();

    // use.md 的声明阶段 + 结算阶段时机（子序列匹配，忽略穿插的 移动牌/帧 atom）
    P1.expectAtoms(
      '选择目标时',
      '使用时',
      '指定目标',
      '成为目标',
      '指定目标后',
      '成为目标后',
      '检测有效性',
    );
  });

  it('使用结算后牌移出处理区，处理区清空', async () => {
    const state = buildState();
    await harness.setup(state);
    const P2 = harness.player('P2');

    const flow = runUseFlow(state, 0, 'c1', [1], '测试杀');
    await harness.waitForStable();
    await P2.pass();
    await flow;

    // 结算帧已弹出 → frameCards 回退到 zones.processing（应为空）
    expect(frameCards(state)).toEqual([]);
    expect(state.zones.discardPile).toContain('c1');
  });

  it('runUseFlow 要求 cardName 已注册 CardEffect（未注册 → 抛错）', async () => {
    const state = buildState();
    await harness.setup(state);
    await expect(runUseFlow(state, 0, 'c1', [1], '不存在的牌')).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
// 4. runPlayFlow 编排流程（直接调用）
// ═══════════════════════════════════════════════════════════

describe('打出牌 runPlayFlow', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('打出牌触发 声明打出时 / 打出牌时 atom，牌从手牌移入处理区', async () => {
    const d1: Card = { id: 'd1', name: '测试闪', suit: '♥', color: '红', rank: '3', type: '基本牌' };
    const state = buildState({ p1Hand: ['d1'], extraCardMap: { d1 } });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // runPlayFlow 在真实调用中总处于一个结算帧内（询问闪/询问杀 resolver 的帧），
    // 自身不 push/pop 帧。此处手动提供帧以对齐真实上下文。
    await pushFrame(state, '测试帧', 0);
    await runPlayFlow(state, 0, 'd1');
    harness.processAllEvents();
    await popFrame(state);

    // play.md 两个时机（子序列匹配，忽略穿插的 移动牌 atom）
    P1.expectAtoms('声明打出时', '打出牌时');
    // 牌已离开手牌，置入处理区（帧的 cards）
    expect(state.players[0].hand).not.toContain('d1');
  });

  it('打出牌不涉及目标选择与效果结算（仅三步原子）', async () => {
    const d2: Card = { id: 'd2', name: '测试闪', suit: '♥', color: '红', rank: '4', type: '基本牌' };
    const state = buildState({ p1Hand: ['d2'], extraCardMap: { d2 } });
    await harness.setup(state);

    const before = state.seq;
    await runPlayFlow(state, 0, 'd2');
    // 三步原子：声明打出时 / 移动牌 / 打出牌时
    const newAtoms = state.atomHistory
      .filter((e) => e.kind === 'atom' && e.seq > before)
      .map((e) => (e as { atom?: { type: string } }).atom?.type ?? '');
    expect(newAtoms).toEqual(['声明打出时', '移动牌', '打出牌时']);
    // P2 不应受任何影响
    expect(state.players[1].health).toBe(4);
  });
});
