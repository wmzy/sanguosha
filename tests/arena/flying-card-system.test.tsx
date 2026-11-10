// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import React from 'react';
import type { GameView, Card } from '../../src/engine/types';
import type { ArenaManifest } from '../../src/arena/types';
import { FlyingCardLayer } from '../../src/client/components/arena/FlyingCardLayer';
import { ArenaTable, arenaPositions } from '../../src/client/components/arena/ArenaTable';

afterEach(cleanup);

function makeTestView(overrides: Partial<GameView> = {}): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌' as any,
    turn: { round: 1, phase: '出牌' as any, vars: {} },
    players: [
      {
        index: 0,
        name: '玩家1',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['仁德'],
        handCount: 3,
        hand: [],
        marks: [],
        tags: [],
        identity: '主公',
      },
      {
        index: 1,
        name: '玩家2',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['奸雄'],
        handCount: 3,
        hand: [],
        marks: [],
        tags: [],
        identity: '反贼',
      },
    ],
    cardMap: {
      c_zhuge: {
        id: 'c_zhuge',
        name: '诸葛连弩',
        suit: '♦',
        rank: 'A',
        color: 'red',
        type: '装备',
        subtype: 'weapon',
      } as unknown as Card,
      c_bagua: {
        id: 'c_bagua',
        name: '八卦阵',
        suit: '♠',
        rank: '2',
        color: 'black',
        type: '装备',
        subtype: 'armor',
      } as unknown as Card,
      c_sha: {
        id: 'c_sha',
        name: '杀',
        suit: '♠',
        rank: '7',
        color: 'black',
        type: '基本',
      } as unknown as Card,
      c_shan: {
        id: 'c_shan',
        name: '闪',
        suit: '♦',
        rank: 'K',
        color: 'red',
        type: '基本',
      } as unknown as Card,
      c_snatch: {
        id: 'c_snatch',
        name: '顺手牵羊',
        suit: '♠',
        rank: '3',
        color: 'black',
        type: '锦囊',
      } as unknown as Card,
      c_dismantle: {
        id: 'c_dismantle',
        name: '过河拆桥',
        suit: '♠',
        rank: '4',
        color: 'black',
        type: '锦囊',
      } as unknown as Card,
    },
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    zones: {
      deckCount: 50,
      discardPileCount: 10,
      processing: [],
    },
    settlementStack: [],
    ...overrides,
  };
}

function makeTestManifest(overrides: Partial<ArenaManifest> = {}): ArenaManifest {
  return {
    id: 'test-match-1',
    name: '测试对局',
    status: 'playing',
    players: [{ id: 'p0', name: '玩家1', mode: 'heuristic' }],
    durationMs: 1000,
    startTime: Date.now(),
    ...overrides,
  } as ArenaManifest;
}

describe('FlyingCardLayer 全息飞牌系统 (Task 1)', () => {
  describe('1. 摸牌动效 (Draw)', () => {
    it('当日志出现摸牌事件时，从中央牌堆飞入目标玩家座次', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({
        log: [],
      });

      const { container, rerender } = render(
        <FlyingCardLayer view={view1} positions={arenaPositions} />
      );

      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();

      // 玩家1（曹操，座次1，坐标 [50, 17]）摸牌
      const view2 = makeTestView({
        log: [{ time: 100, player: 1, text: '摸了 2 张牌' }],
        zones: { deckCount: 48, discardPileCount: 10, processing: [] },
      });

      rerender(<FlyingCardLayer view={view2} positions={arenaPositions} />);

      const flyingCards = container.querySelectorAll('[data-testid="arena-flying-card"]');
      expect(flyingCards.length).toBeGreaterThan(0);

      const firstCard = flyingCards[0];
      expect(firstCard.getAttribute('data-trajectory')).toBe('draw');
      // 起点为中央牌堆 [50, 50]
      expect(firstCard.getAttribute('style')).toContain('--fly-from-x: 50%');
      expect(firstCard.getAttribute('style')).toContain('--fly-from-y: 50%');
      // 终点为玩家1座次 [50, 17]
      expect(firstCard.getAttribute('style')).toContain('--fly-to-x: 50%');
      expect(firstCard.getAttribute('style')).toContain('--fly-to-y: 17%');

      // 动画结束后自动清理
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('2. 出牌与响应飞出 (Play & Respond)', () => {
    it('主动出牌时，从当前出牌者座次飞入中央处理区', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({
        currentPlayerIndex: 0,
        zones: { deckCount: 50, discardPileCount: 10, processing: [] },
      });

      const { container, rerender } = render(
        <FlyingCardLayer view={view1} positions={arenaPositions} />
      );

      // 玩家0出杀
      const view2 = makeTestView({
        currentPlayerIndex: 0,
        zones: { deckCount: 50, discardPileCount: 10, processing: ['c_sha'] },
      });

      rerender(<FlyingCardLayer view={view2} positions={arenaPositions} />);

      const flyingCard = container.querySelector('[data-testid="arena-flying-card"]');
      expect(flyingCard).toBeTruthy();
      expect(flyingCard?.getAttribute('data-trajectory')).toBe('play');
      // 起点为玩家0座次 [50, 82]
      expect(flyingCard?.getAttribute('style')).toContain('--fly-from-x: 50%');
      expect(flyingCard?.getAttribute('style')).toContain('--fly-from-y: 82%');
      // 终点为中央处理区 [50, 48]
      expect(flyingCard?.getAttribute('style')).toContain('--fly-to-x: 50%');
      expect(flyingCard?.getAttribute('style')).toContain('--fly-to-y: 48%');
      expect(flyingCard?.textContent).toContain('杀');

      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();
      vi.useRealTimers();
    });

    it('响应打出牌时（例如被动打出闪），从响应者座次飞入中央处理区', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({
        currentPlayerIndex: 0,
        zones: { deckCount: 50, discardPileCount: 10, processing: ['c_sha'] },
      });

      const { container, rerender } = render(
        <FlyingCardLayer view={view1} positions={arenaPositions} />
      );

      // 玩家1响应出闪（settlementStack 记录 from 为 1）
      const view2 = makeTestView({
        currentPlayerIndex: 0,
        zones: { deckCount: 50, discardPileCount: 10, processing: ['c_sha', 'c_shan'] },
        settlementStack: [
          {
            skillId: '闪',
            from: 1,
            params: { cardId: 'c_shan' },
            cards: ['c_shan'],
            cancelled: false,
          },
        ],
      });

      rerender(<FlyingCardLayer view={view2} positions={arenaPositions} />);

      const flyingCards = container.querySelectorAll('[data-testid="arena-flying-card"]');
      expect(flyingCards.length).toBeGreaterThan(0);

      // 找到 c_shan 对应的飞牌
      const shanFlying = Array.from(flyingCards).find((el) => el.textContent?.includes('闪'));
      expect(shanFlying).toBeTruthy();
      expect(shanFlying?.getAttribute('data-trajectory')).toBe('respond');
      // 起点为玩家1座次 [50, 17]
      expect(shanFlying?.getAttribute('style')).toContain('--fly-from-x: 50%');
      expect(shanFlying?.getAttribute('style')).toContain('--fly-from-y: 17%');
      // 终点为中央处理区 [50, 48]
      expect(shanFlying?.getAttribute('style')).toContain('--fly-to-x: 50%');
      expect(shanFlying?.getAttribute('style')).toContain('--fly-to-y: 48%');

      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();
      vi.useRealTimers();
    });

    it('响应南蛮/决斗打出杀时，日志出现响应【杀】即刻从响应者座次飞出', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({ log: [] });
      const { container, rerender } = render(
        <FlyingCardLayer view={view1} positions={arenaPositions} />
      );

      // 玩家1响应打出杀
      const view2 = makeTestView({
        log: [{ time: 150, player: 1, text: '响应【杀】(♠9)' }],
      });
      rerender(<FlyingCardLayer view={view2} positions={arenaPositions} />);

      const flyingCards = container.querySelectorAll('[data-testid="arena-flying-card"]');
      expect(flyingCards.length).toBeGreaterThan(0);
      const shaFlying = Array.from(flyingCards).find((el) => el.textContent?.includes('杀'));
      expect(shaFlying).toBeTruthy();
      expect(shaFlying?.getAttribute('data-trajectory')).toBe('respond');
      expect(shaFlying?.getAttribute('style')).toContain('--fly-from-x: 50%');
      expect(shaFlying?.getAttribute('style')).toContain('--fly-from-y: 17%');
      expect(shaFlying?.getAttribute('style')).toContain('--fly-to-x: 50%');
      expect(shaFlying?.getAttribute('style')).toContain('--fly-to-y: 48%');

      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('3. 顺手牵羊 (Snatch)', () => {
    it('当顺手牵羊结算时，卡牌从受害方座次平滑飞入发起方座次', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({
        log: [],
      });

      const { container, rerender } = render(
        <FlyingCardLayer view={view1} positions={arenaPositions} />
      );

      // 玩家0从玩家1（曹操）处获得了诸葛连弩
      const view2 = makeTestView({
        log: [{ time: 200, player: 0, text: '从 曹操 处获得了 诸葛连弩' }],
      });

      rerender(<FlyingCardLayer view={view2} positions={arenaPositions} />);

      const flyingCard = container.querySelector('[data-testid="arena-flying-card"]');
      expect(flyingCard).toBeTruthy();
      expect(flyingCard?.getAttribute('data-trajectory')).toBe('snatch');
      // 起点为受害方（曹操/玩家1）座次 [50, 17]
      expect(flyingCard?.getAttribute('style')).toContain('--fly-from-x: 50%');
      expect(flyingCard?.getAttribute('style')).toContain('--fly-from-y: 17%');
      // 终点为发起方（玩家0）座次 [50, 82]
      expect(flyingCard?.getAttribute('style')).toContain('--fly-to-x: 50%');
      expect(flyingCard?.getAttribute('style')).toContain('--fly-to-y: 82%');
      expect(flyingCard?.textContent).toContain('诸葛连弩');

      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();
      vi.useRealTimers();
    });

    it('真实日志使用【顺手牵羊】→ 目标，卡牌从受害方座次飞入发起方座次', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({ log: [] });
      const { container, rerender } = render(
        <FlyingCardLayer view={view1} positions={arenaPositions} />
      );

      // 玩家0对玩家1使用顺手牵羊
      const view2 = makeTestView({
        log: [{ time: 250, player: 0, text: '使用【顺手牵羊】(♦3) → 曹操' }],
      });
      rerender(<FlyingCardLayer view={view2} positions={arenaPositions} />);

      const flyingCard = container.querySelector('[data-testid="arena-flying-card"]');
      expect(flyingCard).toBeTruthy();
      expect(flyingCard?.getAttribute('data-trajectory')).toBe('snatch');
      expect(flyingCard?.getAttribute('style')).toContain('--fly-from-x: 50%');
      expect(flyingCard?.getAttribute('style')).toContain('--fly-from-y: 17%');
      expect(flyingCard?.getAttribute('style')).toContain('--fly-to-x: 50%');
      expect(flyingCard?.getAttribute('style')).toContain('--fly-to-y: 82%');

      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('4. 过河拆桥与弃牌 (Dismantle & Discard)', () => {
    it('当弃牌或拆桥发生时，卡牌从目标座次飞向中央弃牌堆并伴随消隐', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({
        log: [],
      });

      const { container, rerender } = render(
        <FlyingCardLayer view={view1} positions={arenaPositions} />
      );

      // 玩家1弃置了2张牌
      const view2 = makeTestView({
        log: [{ time: 300, player: 1, text: '弃置了 2 张牌：杀、闪' }],
        zones: { deckCount: 50, discardPileCount: 12, processing: [] },
      });

      rerender(<FlyingCardLayer view={view2} positions={arenaPositions} />);

      const flyingCards = container.querySelectorAll('[data-testid="arena-flying-card"]');
      expect(flyingCards.length).toBeGreaterThan(0);

      const firstCard = flyingCards[0];
      expect(firstCard.getAttribute('data-trajectory')).toBe('discard');
      // 起点为玩家1座次 [50, 17]
      expect(firstCard.getAttribute('style')).toContain('--fly-from-x: 50%');
      expect(firstCard.getAttribute('style')).toContain('--fly-from-y: 17%');
      // 终点为中央弃牌堆 [50, 50]
      expect(firstCard.getAttribute('style')).toContain('--fly-to-x: 50%');
      expect(firstCard.getAttribute('style')).toContain('--fly-to-y: 50%');

      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('5. 队列平滑管理与 DOM 自动清理', () => {
    it('连续多次快速事件不会累积 DOM 孤立节点', () => {
      vi.useFakeTimers();
      const view1 = makeTestView();
      const { container, rerender } = render(
        <FlyingCardLayer view={view1} positions={arenaPositions} />
      );

      // 第1波：摸牌
      const view2 = makeTestView({
        log: [{ time: 100, player: 0, text: '摸了 2 张牌' }],
      });
      rerender(<FlyingCardLayer view={view2} positions={arenaPositions} />);
      expect(container.querySelectorAll('[data-testid="arena-flying-card"]').length).toBe(2);

      // 推进 300ms（动画尚未结束）
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // 第2波：出牌
      const view3 = makeTestView({
        currentPlayerIndex: 0,
        log: [
          { time: 100, player: 0, text: '摸了 2 张牌' },
          { time: 150, player: 0, text: '使用了【杀】' },
        ],
        zones: { deckCount: 50, discardPileCount: 10, processing: ['c_sha'] },
      });
      rerender(<FlyingCardLayer view={view3} positions={arenaPositions} />);
      // 队列中应包含摸牌和出牌
      expect(container.querySelectorAll('[data-testid="arena-flying-card"]').length).toBe(3);

      // 再推进 500ms（第1波结束）
      act(() => {
        vi.advanceTimersByTime(500);
      });
      // 摸牌已移除，出牌可能还在或即将结束
      // 最终推进 500ms
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(container.querySelectorAll('[data-testid="arena-flying-card"]').length).toBe(0);
      vi.useRealTimers();
    });
  });

  describe('6. ArenaTable 集成与兼容性', () => {
    it('在 ArenaTable 中挂载并正确呈现飞牌效果', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({
        currentPlayerIndex: 0,
        zones: { deckCount: 50, discardPileCount: 10, processing: [] },
      });

      const { container, rerender } = render(
        <ArenaTable view={view1} manifest={makeTestManifest()} assetsReady={true} />
      );

      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();

      const view2 = makeTestView({
        currentPlayerIndex: 0,
        zones: { deckCount: 50, discardPileCount: 10, processing: ['c_sha'] },
      });

      rerender(<ArenaTable view={view2} manifest={makeTestManifest()} assetsReady={true} />);

      const flyingCard = container.querySelector('[data-testid="arena-flying-card"]');
      expect(flyingCard).toBeTruthy();
      expect(flyingCard?.getAttribute('style')).toContain('--fly-from-x');
      expect(flyingCard?.getAttribute('style')).toContain('--fly-from-y');

      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();
      vi.useRealTimers();
    });
  });
});
