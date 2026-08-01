// tests/client/autoSkip.test.ts
// autoSkip 纯决策函数单测。
// 归并说明(AGENTS.md):autoSkip 是跨技能的通用客户端辅助模块,不属于某个具体技能,
// 故独立成文件。覆盖维度1(强制无法响应跳过)+ 维度2(用户策略跳过)的所有分支。
import { describe, it, expect } from 'vitest';
import {
  decideAutoSkip,
  computeCanRespondForView,
  DEFAULT_DELAY_RANGE,
  type AutoSkipPrefs,
} from '../../src/client/utils/autoSkip';
import type { Card, GameView, PendingView } from '../../src/engine/types';
import type { SkillActionDef } from '../../src/client/skillActionRegistry';

// ─── fixtures ────────────────────────────────────────────────

function mkPending(overrides: Partial<PendingView> = {}): PendingView {
  return {
    type: 'awaits',
    // 引擎层 Atom/ActionPrompt 类型较严格,测试 fixture 用宽松类型绕过(仅前端决策用 requestType/target/isBlocking)
    atom: { type: '请求回应', requestType: '无懈可击', target: -2 } as PendingView['atom'],
    prompt: { type: 'useCard', title: '是否打出无懈可击?' } as PendingView['prompt'],
    target: -2,
    isBlocking: true,
    deadline: Date.now() + 10000,
    totalMs: 10000,
    ...overrides,
  };
}

function mkView(handCount: number, viewer = 0): GameView {
  return {
    viewer,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      { index: 0, name: 'P0', character: '', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [], handCount, marks: [] },
      { index: 1, name: 'P1', character: '', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [], handCount: 4, marks: [] },
    ],
    cardMap: {},
    pending: mkPending(),
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

const NO_PREFS: AutoSkipPrefs = { optInSkip: {} };
const FIXED_RNG = () => 0.5; // 取范围中点

// ─── decideAutoSkip:维度1(强制无法响应跳过) ────────────────────

describe('decideAutoSkip — 维度1:无法响应自动跳过(强制)', () => {
  it('空手牌 + 无法响应 → act-now(公开可知,立即跳过)', () => {
    const d = decideAutoSkip({
      pending: mkPending(), canRespond: false, handCount: 0, prefs: NO_PREFS, rng: FIXED_RNG,
    });
    expect(d).toEqual({ kind: 'act-now' });
  });

  it('有手牌但无法响应 → act-delayed(私有,延迟防泄露)', () => {
    const d = decideAutoSkip({
      pending: mkPending(), canRespond: false, handCount: 3, prefs: NO_PREFS, rng: FIXED_RNG,
    });
    expect(d.kind).toBe('act-delayed');
    if (d.kind === 'act-delayed') {
      // 中点 rng=0.5 → (500+2000)/2 = 1250
      expect(d.ms).toBe(1250);
    }
  });

  it('能响应 → wait(绝不干预)', () => {
    const d = decideAutoSkip({
      pending: mkPending(), canRespond: true, handCount: 1, prefs: NO_PREFS, rng: FIXED_RNG,
    });
    expect(d).toEqual({ kind: 'wait' });
  });

  it('延迟范围自定义', () => {
    const d = decideAutoSkip({
      pending: mkPending(), canRespond: false, handCount: 2, prefs: NO_PREFS,
      delayRange: [100, 300], rng: () => 0,
    });
    expect(d).toEqual({ kind: 'act-delayed', ms: 100 });
  });

  it('rng=0 取下界,rng=1 取上界', () => {
    const lo = decideAutoSkip({ pending: mkPending(), canRespond: false, handCount: 1, prefs: NO_PREFS, rng: () => 0 });
    const hi = decideAutoSkip({ pending: mkPending(), canRespond: false, handCount: 1, prefs: NO_PREFS, rng: () => 1 });
    expect(lo).toEqual({ kind: 'act-delayed', ms: DEFAULT_DELAY_RANGE[0] });
    expect(hi).toEqual({ kind: 'act-delayed', ms: DEFAULT_DELAY_RANGE[1] });
  });
});

// ─── decideAutoSkip:维度2(用户策略跳过) ──────────────────────

describe('decideAutoSkip — 维度2:用户策略跳过(optInSkip)', () => {
  const prefs: AutoSkipPrefs = { optInSkip: { '无懈可击': true } };

  it('开启策略跳过 + 能响应 → 仍 act-delayed(不暴露能否响应)', () => {
    const d = decideAutoSkip({
      pending: mkPending(), canRespond: true, handCount: 2, prefs, rng: FIXED_RNG,
    });
    expect(d.kind).toBe('act-delayed');
  });

  it('开启策略跳过 + 空手牌 → act-delayed(策略优先于维度1的立即)', () => {
    const d = decideAutoSkip({
      pending: mkPending(), canRespond: false, handCount: 0, prefs, rng: FIXED_RNG,
    });
    // 策略跳过总是延迟(避免与其他场景的跳过时机不同而泄露"我开了自动跳过")
    expect(d.kind).toBe('act-delayed');
  });

  it('未开启的 requestType → 不触发策略跳过', () => {
    const d = decideAutoSkip({
      pending: mkPending({
        atom: { type: '请求回应', requestType: '闪', target: 1 } as PendingView['atom'],
      }),
      canRespond: true, handCount: 2, prefs, rng: FIXED_RNG,
    });
    expect(d).toEqual({ kind: 'wait' });
  });
});

// ─── decideAutoSkip:边界排除 ──────────────────────────────────

describe('decideAutoSkip — 边界:不干预的 pending', () => {
  it('pending 为 null → wait', () => {
    expect(decideAutoSkip({ pending: null, canRespond: false, handCount: 0, prefs: NO_PREFS }))
      .toEqual({ kind: 'wait' });
  });

  it('出牌窗口(isBlocking===false)→ wait', () => {
    const d = decideAutoSkip({
      pending: mkPending({ isBlocking: false }), canRespond: false, handCount: 0, prefs: NO_PREFS,
    });
    expect(d).toEqual({ kind: 'wait' });
  });

  it('强制型(mandatory=true)→ wait', () => {
    const d = decideAutoSkip({
      pending: mkPending({ mandatory: true }), canRespond: false, handCount: 4, prefs: NO_PREFS,
    });
    expect(d).toEqual({ kind: 'wait' });
  });
});

// ─── computeCanRespondForView ────────────────────────────────

describe('computeCanRespondForView — 前端 canRespond 计算', () => {
  it('非 useCard prompt(confirm)→ true(总有按钮)', () => {
    const view = mkView(0);
    view.pending = mkPending({
      prompt: { type: 'confirm', title: '是否发动?' } as PendingView['prompt'],
    });
    expect(computeCanRespondForView(view, 0, [], null, view.pending)).toBe(true);
  });

  it('useCard + 无 cardFilter + 无转化技 → false', () => {
    const view = mkView(3);
    expect(computeCanRespondForView(view, 0, [], null, view.pending)).toBe(false);
  });

  it('useCard + cardFilter 匹配手牌 → true', () => {
    const view = mkView(2);
    view.players[0].hand = [
      { id: 'w1', name: '无懈可击', suit: '♠', color: '黑', rank: 'J', type: '锦囊牌' } as Card,
    ];
    const info = { skillId: '无懈可击', cardFilter: (c: Card) => c.name === '无懈可击' };
    expect(computeCanRespondForView(view, 0, [], info, view.pending)).toBe(true);
  });

  it('useCard + cardFilter 不匹配 + 有激活转化技 → true(看破)', () => {
    const view = mkView(2);
    view.players[0].hand = [
      { id: 'b1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' } as Card,
    ];
    const transformAction = {
      skillId: '看破', ownerId: 0, actionType: 'transform', label: '看破',
      prompt: { type: 'useCard' as const, title: '看破', cardFilter: { filter: () => true, min: 1, max: 1 } },
      activeWhen: () => true, // 模拟看破在无懈窗口激活
    } as unknown as SkillActionDef;
    expect(computeCanRespondForView(view, 0, [transformAction], null, view.pending)).toBe(true);
  });

  it('useCard + cardFilter 不匹配 + 转化技未激活 → false', () => {
    const view = mkView(2);
    const transformAction = {
      skillId: '看破', ownerId: 0, actionType: 'transform', label: '看破',
      prompt: { type: 'useCard' as const, title: '看破', cardFilter: { filter: () => true, min: 1, max: 1 } },
      activeWhen: () => false, // 未激活(非无懈窗口或无黑牌)
    } as unknown as SkillActionDef;
    expect(computeCanRespondForView(view, 0, [transformAction], null, view.pending)).toBe(false);
  });

  it('pending 为 null → false', () => {
    expect(computeCanRespondForView(mkView(2), 0, [], null, null)).toBe(false);
  });
});
