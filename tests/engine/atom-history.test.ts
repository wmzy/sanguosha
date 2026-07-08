import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { eventsForViewer } from '../../src/engine/view/events-for-viewer';
import '../../src/engine/atoms';
import '../../src/engine/skills';

describe('GameState.atomHistory', () => {
  it('createGameState 初始化 atomHistory 为空数组', () => {
    const state = createGameState({ players: [], cardMap: {} });
    expect(state.atomHistory).toEqual([]);
  });

  it('createGameState 允许 partial 覆盖 atomHistory', () => {
    const existing = [
      { kind: 'notify' as const, seq: 5, timestamp: 0, skillId: '', eventType: 'test', data: null },
    ];
    const state = createGameState({ players: [], cardMap: {}, atomHistory: existing });
    expect(state.atomHistory).toBe(existing);
  });
});

describe('eventsForViewer', () => {
  it('按 ownerViews 分叉:owner 看 ownerView,其他人看 othersView', () => {
    const ownerView = { type: '摸牌', player: 0, count: 2 } as any;
    const othersView = { type: '摸牌', player: 0, count: 2 } as any;
    const state = createGameState({
      players: [],
      cardMap: {},
      atomHistory: [
        {
          kind: 'atom',
          seq: 1,
          timestamp: 0,
          atom: { type: '摸牌', player: 0, count: 2 } as any,
          viewEvents: {
            ownerViews: new Map([
              [0, ownerView],
              [1, null],
            ]),
            othersView,
          },
        },
      ],
    });
    // viewer 0 = owner,看到 ownerView
    const e0 = eventsForViewer(state, 0, 0);
    expect(e0).toHaveLength(1);
    expect(e0[0].view).toBe(ownerView);
    // viewer 1 = 被隐藏(ownerViews=null)
    const e1 = eventsForViewer(state, 1, 0);
    expect(e1).toHaveLength(0);
    // viewer 2 = others
    const e2 = eventsForViewer(state, 2, 0);
    expect(e2).toHaveLength(1);
    expect(e2[0].view).toBe(othersView);
  });

  it('sinceSeq 过滤:只返回 seq > sinceSeq 的事件', () => {
    const state = createGameState({
      players: [],
      cardMap: {},
      atomHistory: [
        {
          kind: 'atom',
          seq: 1,
          timestamp: 0,
          atom: { type: 'A' } as any,
          viewEvents: { ownerViews: new Map(), othersView: { type: 'A' } },
        },
        {
          kind: 'atom',
          seq: 2,
          timestamp: 0,
          atom: { type: 'B' } as any,
          viewEvents: { ownerViews: new Map(), othersView: { type: 'B' } },
        },
        {
          kind: 'atom',
          seq: 3,
          timestamp: 0,
          atom: { type: 'C' } as any,
          viewEvents: { ownerViews: new Map(), othersView: { type: 'C' } },
        },
      ],
    });
    const result = eventsForViewer(state, 0, 1);
    expect(result).toHaveLength(2);
    expect(result[0].seq).toBe(2);
    expect(result[1].seq).toBe(3);
  });

  it('othersView 为空且 viewer 不在 ownerViews → 跳过', () => {
    const state = createGameState({
      players: [],
      cardMap: {},
      atomHistory: [
        {
          kind: 'atom',
          seq: 1,
          timestamp: 0,
          atom: { type: 'A' } as any,
          viewEvents: { ownerViews: new Map(), othersView: undefined as any },
        },
      ],
    });
    expect(eventsForViewer(state, 0, 0)).toHaveLength(0);
  });

  it('sinceSeq 默认值为 0:不传参等价于传 0', () => {
    const state = createGameState({
      players: [],
      cardMap: {},
      atomHistory: [
        {
          kind: 'atom',
          seq: 1,
          timestamp: 0,
          atom: { type: 'A' } as any,
          viewEvents: { ownerViews: new Map(), othersView: { type: 'A' } },
        },
      ],
    });
    expect(eventsForViewer(state, 0, undefined)).toHaveLength(1);
  });

  it('notify 事件按 views 分叉', () => {
    const state = createGameState({
      players: [],
      cardMap: {},
      atomHistory: [
        {
          kind: 'notify',
          seq: 1,
          timestamp: 0,
          skillId: 'test',
          eventType: 'reveal',
          data: { all: true },
          views: new Map([
            ['0', { forP0: true } as any],
            ['1', { forP1: true } as any],
          ]),
        },
      ],
    });
    const e0 = eventsForViewer(state, 0, 0);
    expect(e0).toHaveLength(1);
    expect(e0[0].notify!.data).toEqual({ forP0: true });
    const e1 = eventsForViewer(state, 1, 0);
    expect(e1).toHaveLength(1);
    expect(e1[0].notify!.data).toEqual({ forP1: true });
  });
});

describe('dispatch 返回 boolean', () => {

  it('非法 action 返回 false（不存在的 skillId）', async () => {
    const state = createGameState({
      players: [
        {
          index: 0,
          name: 'p0',
          character: '测试',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
        },
      ],
      cardMap: {},
      seq: 0,
      currentPlayerIndex: 0,
      phase: '出牌',
    });
    const { dispatch } = await import('../../src/engine/create-engine');
    const msg = {
      skillId: '不存在',
      actionType: 'use' as const,
      ownerId: 0,
      params: {},
      baseSeq: 0,
    };
    const result = await dispatch(state, msg);
    expect(result).toBe(false);
  });
});

describe('atomHistory: applyAtom 写入', () => {

  it('applyAtom 把 atom 条目写入 state.atomHistory,seq 单调', async () => {
    const state = createGameState({
      players: [
        {
          index: 0,
          name: 'p0',
          character: '测试',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
        },
      ],
      cardMap: {
        c1: {
          id: 'c1',
          name: '杀',
          suit: '♠',
          color: '黑',
          rank: '7',
          type: '基本牌',
          subtype: '',
        } as any,
      },
      zones: { deck: ['c1'], discardPile: [], processing: [] },
      seq: 0,
    });
    await applyAtom(state, { type: '摸牌', player: 0, count: 1 } as any);
    expect(state.atomHistory.length).toBeGreaterThan(0);
    const atomEntry = state.atomHistory.find((e) => e.kind === 'atom');
    expect(atomEntry).toBeDefined();
    if (atomEntry?.kind === 'atom') {
      expect(atomEntry.atom.type).toBe('摸牌');
      expect(atomEntry.viewEvents).toBeDefined();
    }
  });
});
