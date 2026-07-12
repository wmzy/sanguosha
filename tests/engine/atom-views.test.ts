// tests/engine/atom-views.test.ts
// atom 视图层覆盖率补充:并行回应 / 移除延时锦囊 的 toViewEvents + applyView
import { describe, it, expect } from 'vitest';
import { createGameState } from '../../src/engine/types';
import { getAtomDef } from '../../src/engine/atom';
import type { GameState, GameView, Card, PendingTrick } from '../../src/engine/types';

// 导入以注册所有 atom
import '../../src/engine/atoms';

function makeState(): GameState {
  return createGameState({
    players: [
      {
        index: 0,
        name: '玩家0',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        pendingTricks: [],
        skills: [],
        vars: {},
        marks: [],
        tags: [],
      },
      {
        index: 1,
        name: '玩家1',
        character: '关羽',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        pendingTricks: [],
        skills: [],
        vars: {},
        marks: [],
        tags: [],
      },
    ],
    cardMap: {},
  });
}

function makeView(viewer: number): GameView {
  const state = makeState();
  return {
    viewer,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: state.players.map((p) => ({
      index: p.index,
      name: p.name,
      character: p.character,
      health: p.health,
      maxHealth: p.maxHealth,
      alive: p.alive,
      equipment: p.equipment,
      skills: p.skills,
      handCount: 0,
      marks: [],
      pendingTricks: [],
    })),
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

// ─── 并行回应 ───────────────────────────────────────────────
describe('并行回应 atom', () => {
  const def = getAtomDef('并行回应');

  it('validate:空 targets 返回错误', () => {
    const state = makeState();
    const err = def.validate(state, {
      type: '并行回应',
      requestType: '拼点',
      targets: [],
      prompt: { type: 'confirm', title: '测试' },
    });
    expect(err).toBe('targets required');
  });

  it('validate:不存在的 target 返回错误', () => {
    const state = makeState();
    const err = def.validate(state, {
      type: '并行回应',
      requestType: '拼点',
      targets: [0, 99],
      prompt: { type: 'confirm', title: '测试' },
    });
    expect(err).toContain('not found');
  });

  it('validate:合法 targets 返回 null', () => {
    const state = makeState();
    const err = def.validate(state, {
      type: '并行回应',
      requestType: '拼点',
      targets: [0, 1],
      prompt: { type: 'confirm', title: '测试' },
    });
    expect(err).toBeNull();
  });

  it('toViewEvents:owner 看到带 prompt 的请求,其他人看到简化版', () => {
    const state = makeState();
    const split = def.toViewEvents!(state, {
      type: '并行回应',
      requestType: '拼点',
      targets: [0, 1],
      prompt: { type: 'confirm', title: '请拼点' },
    })!;

    // 两个 owner 各自看到带 prompt 的事件
    const owner0 = split.ownerViews.get(0)!;
    expect(owner0).toBeTruthy();
    expect(owner0.type).toBe('请求回应');
    expect(owner0.target).toBe(0);
    expect((owner0 as { prompt?: unknown }).prompt).toBeTruthy();

    const owner1 = split.ownerViews.get(1)!;
    expect(owner1).toBeTruthy();
    expect(owner1.target).toBe(1);

    // othersView 存在(target = targets[0])
    expect(split.othersView).toBeTruthy();
    expect(split.othersView!.type).toBe('请求回应');
  });

  it('applyView:target viewer 设置完整 pending(可操作)', () => {
    const view = makeView(0);
    const timeoutMs = 30000;
    def.applyView!(view, {
      type: '请求回应',
      requestType: '拼点',
      target: 0,
      prompt: { type: 'confirm', title: '请拼点' },
      timeoutMs,
    });

    expect(view.pending).not.toBeNull();
    expect(view.pending!.type).toBe('awaits');
    expect(view.pending!.target).toBe(0);
    expect(view.pending!.prompt).toEqual({ type: 'confirm', title: '请拼点' });
    expect(view.pending!.deadline).toBeGreaterThan(0);
    expect(view.pending!.totalMs).toBe(timeoutMs);
  });

  it('applyView:非 target viewer 设置观察型 pending(不可操作)', () => {
    const view = makeView(2); // viewer 2 不在 targets 中
    def.applyView!(view, {
      type: '请求回应',
      requestType: '拼点',
      target: 0,
      prompt: { type: 'confirm', title: '请拼点' },
      timeoutMs: 30000,
    });

    expect(view.pending).not.toBeNull();
    expect(view.pending!.type).toBe('awaits');
    expect(view.pending!.target).toBe(0);
    // 观察型:prompt 是 "等待回应"
    const prompt = view.pending!.prompt as { title: string };
    expect(prompt.title).toBe('等待回应');
  });

  it('applyView:target viewer 但无 prompt 时不设置 pending', () => {
    const view = makeView(0);
    def.applyView!(view, {
      type: '请求回应',
      requestType: '拼点',
      target: 0,
      // 无 prompt 字段
      timeoutMs: 30000,
    });

    expect(view.pending).toBeNull();
  });

  it('applyView:无 timeoutMs 时使用默认值', () => {
    const view = makeView(0);
    def.applyView!(view, {
      type: '请求回应',
      requestType: '拼点',
      target: 0,
      prompt: { type: 'confirm', title: '测试' },
      // 无 timeoutMs
    });

    expect(view.pending).not.toBeNull();
    // DEFAULT_TIMEOUT_SEC * 1000 = 30000
    expect(view.pending!.totalMs).toBe(30000);
  });
});

// ─── 移除延时锦囊 ───────────────────────────────────────────
describe('移除延时锦囊 atom', () => {
  const def = getAtomDef('移除延时锦囊');

  function makeCardMap(trickCard: Card): Record<string, Card> {
    return { [trickCard.id]: trickCard };
  }

  const trickCard: Card = {
    id: 'lebu-1',
    name: '乐不思蜀',
    suit: '♥',
    color: '红',
    rank: '3',
    type: '锦囊牌',
    trickSubtype: '延时锦囊',
  };

  function makeViewWithTrick(viewer: number, cardMap: Record<string, Card>): GameView {
    const view = makeView(viewer);
    view.cardMap = cardMap;
    view.players[0].pendingTricks = ['lebu-1'];
    return view;
  }

  it('validate:不存在的 player 返回错误', () => {
    const state = makeState();
    const err = def.validate(state, { type: '移除延时锦囊', player: 99, trickName: '乐不思蜀' });
    expect(err).toContain('not found');
  });

  it('validate:合法 player 返回 null', () => {
    const state = makeState();
    const err = def.validate(state, { type: '移除延时锦囊', player: 0, trickName: '乐不思蜀' });
    expect(err).toBeNull();
  });

  it('apply:从 pendingTricks 中过滤掉匹配的 trickName', () => {
    const state = makeState();
    const trick: PendingTrick = { name: '乐不思蜀', source: 1, card: trickCard };
    state.players[0].pendingTricks = [
      trick,
      { name: '闪电', source: -1, card: { ...trickCard, id: 'shandian-1', name: '闪电' } },
    ];

    def.apply(state, { type: '移除延时锦囊', player: 0, trickName: '乐不思蜀' });

    expect(state.players[0].pendingTricks).toHaveLength(1);
    expect(state.players[0].pendingTricks[0].name).toBe('闪电');
  });

  it('toViewEvents:携带匹配 trick 的 cardId', () => {
    const state = makeState();
    state.players[0].pendingTricks = [
      { name: '乐不思蜀', source: 1, card: trickCard },
    ];

    const split = def.toViewEvents!(state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '乐不思蜀',
    })!;

    expect(split.othersView).toBeTruthy();
    expect((split.othersView as { cardId?: string }).cardId).toBe('lebu-1');
    expect((split.othersView as { trickName?: string }).trickName).toBe('乐不思蜀');
  });

  it('toViewEvents:无匹配 trick 时不含 cardId', () => {
    const state = makeState();
    state.players[0].pendingTricks = [
      { name: '闪电', source: -1, card: { ...trickCard, id: 'sd-1', name: '闪电' } },
    ];

    const split = def.toViewEvents!(state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '乐不思蜀',
    })!;

    expect((split.othersView as { cardId?: string }).cardId).toBeUndefined();
  });

  it('applyView:按 cardId 移除', () => {
    const cardMap = makeCardMap(trickCard);
    const view = makeViewWithTrick(0, cardMap);

    def.applyView!(view, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '乐不思蜀',
      cardId: 'lebu-1',
    });

    expect(view.players[0].pendingTricks).toHaveLength(0);
  });

  it('applyView:无 cardId 时按 trickName 反查 cardMap', () => {
    const cardMap = makeCardMap(trickCard);
    const view = makeViewWithTrick(0, cardMap);

    def.applyView!(view, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '乐不思蜀',
      // 无 cardId
    });

    expect(view.players[0].pendingTricks).toHaveLength(0);
  });

  it('applyView:无 cardId 且 cardMap 中找不到时保留 list', () => {
    const view = makeViewWithTrick(0, {}); // 空 cardMap
    // pendingTricks 有 lebu-1 但 cardMap 为空
    view.players[0].pendingTricks = ['lebu-1'];

    def.applyView!(view, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '乐不思蜀',
    });

    // 无法定位 → 保留 list 原样
    expect(view.players[0].pendingTricks).toHaveLength(1);
  });

  it('applyView:pendingTricks 为空时 no-op', () => {
    const view = makeView(0);
    view.players[0].pendingTricks = [];

    def.applyView!(view, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '乐不思蜀',
      cardId: 'lebu-1',
    });

    expect(view.players[0].pendingTricks).toHaveLength(0);
  });

  it('applyView:player 不存在于 view 中时 no-op', () => {
    const view = makeView(0);
    // view 中只有 player 0 和 1

    def.applyView!(view, {
      type: '移除延时锦囊',
      player: 99, // 不存在
      trickName: '乐不思蜀',
      cardId: 'lebu-1',
    });

    // 不抛异常
    expect(view.players).toHaveLength(2);
  });

  it('applyView:无 cardId 且无 trickName 时 no-op', () => {
    const view = makeViewWithTrick(0, makeCardMap(trickCard));

    def.applyView!(view, {
      type: '移除延时锦囊',
      player: 0,
      // 无 cardId, 无 trickName
    });

    expect(view.players[0].pendingTricks).toHaveLength(1);
  });
});
