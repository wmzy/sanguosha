// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import React from 'react';
import type { GameView, Card } from '../../src/engine/types';
import type { ArenaManifest } from '../../src/arena/types';
import { IronChainOverlay, isPlayerChained } from '../../src/client/components/arena/IronChainOverlay';
import { TargetPointerSvg } from '../../src/client/components/arena/TargetPointerSvg';
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
        character: '庞统',
        health: 3,
        maxHealth: 3,
        alive: true,
        equipment: {},
        skills: ['连环'],
        handCount: 3,
        hand: [],
        marks: [],
        tags: [],
        identity: '反贼',
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
        identity: '主公',
      },
      {
        index: 2,
        name: '玩家3',
        character: '许褚',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['裸衣'],
        handCount: 3,
        hand: [],
        marks: [],
        tags: [],
        identity: '忠臣',
      },
    ],
    cardMap: {
      c_chain: {
        id: 'c_chain',
        name: '铁索连环',
        suit: '♠',
        rank: 'J',
        color: 'black',
        type: '锦囊',
      } as unknown as Card,
      c_sha: {
        id: 'c_sha',
        name: '杀',
        suit: '♠',
        rank: '7',
        color: 'black',
        type: '基本',
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
    id: 'test-match-chain',
    name: '铁索连环测试对局',
    status: 'playing',
    players: [
      { id: 'p0', name: '玩家1', mode: 'heuristic' },
      { id: 'p1', name: '玩家2', mode: 'heuristic' },
      { id: 'p2', name: '玩家3', mode: 'heuristic' },
    ],
    durationMs: 1000,
    startTime: Date.now(),
    ...overrides,
  } as ArenaManifest;
}

describe('Task 2: 铁索连环实体锁链缠绕与多目标指向', () => {
  describe('1. isPlayerChained 辅助判断函数', () => {
    it('正确识别 marks 中的 连环 / 横置 / chained 状态', () => {
      expect(isPlayerChained(null)).toBe(false);
      expect(isPlayerChained({ marks: [] })).toBe(false);
      expect(isPlayerChained({ marks: [{ id: '连环' }] })).toBe(true);
      expect(isPlayerChained({ marks: [{ id: '横置' }] })).toBe(true);
      expect(isPlayerChained({ marks: [{ id: 'chained' }] })).toBe(true);
      expect(isPlayerChained({ marks: [{ id: 'otherMark' }] })).toBe(false);
    });
  });

  describe('2. IronChainOverlay 实体金属粗铁链覆层组件', () => {
    it('未连环状态下不渲染任何 DOM', () => {
      const { container } = render(<IronChainOverlay chained={false} />);
      expect(container.querySelector('[data-testid="arena-iron-chain"]')).toBeNull();
    });

    it('连环状态下渲染 SVG 交叉粗铁链覆层与冷银蓝脉冲流光', () => {
      const { container } = render(<IronChainOverlay chained={true} />);
      const overlay = container.querySelector('[data-testid="arena-iron-chain"]');
      expect(overlay).toBeTruthy();
      expect(overlay?.getAttribute('data-state')).toBe('locked');

      // 验证对角交叉结构
      const diag1 = overlay?.querySelector('.arena-chain-diagonal-1');
      const diag2 = overlay?.querySelector('.arena-chain-diagonal-2');
      expect(diag1).toBeTruthy();
      expect(diag2).toBeTruthy();

      // 验证冷银蓝金属流光与中心铁锁扣
      const pulseFlows = overlay?.querySelectorAll('.arena-iron-chain-pulse');
      expect(pulseFlows && pulseFlows.length).toBeGreaterThan(0);
      const lockCenter = overlay?.querySelector('.arena-chain-lock-center');
      expect(lockCenter).toBeTruthy();
    });

    it('通过 marks 属性传入连环或横置标记时同样正确渲染', () => {
      const { container, rerender } = render(
        <IronChainOverlay marks={[{ id: '横置' }]} />
      );
      expect(container.querySelector('[data-testid="arena-iron-chain"]')).toBeTruthy();

      rerender(<IronChainOverlay marks={[{ id: '连环' }]} />);
      expect(container.querySelector('[data-testid="arena-iron-chain"]')).toBeTruthy();

      rerender(<IronChainOverlay marks={[{ id: 'chained' }]} />);
      expect(container.querySelector('[data-testid="arena-iron-chain"]')).toBeTruthy();
    });

    it('当角色解除连环时，铁链进入断裂消隐状态并随后自动移除', () => {
      vi.useFakeTimers();
      const { container, rerender } = render(<IronChainOverlay chained={true} />);
      expect(container.querySelector('[data-testid="arena-iron-chain"]')).toBeTruthy();

      // 切换为解除连环
      rerender(<IronChainOverlay chained={false} />);

      // 断裂中：展示 is-breaking 样式与 data-state="breaking"
      const breakingOverlay = container.querySelector('[data-testid="arena-iron-chain"]');
      expect(breakingOverlay).toBeTruthy();
      expect(breakingOverlay?.getAttribute('data-state')).toBe('breaking');
      expect(breakingOverlay?.className).toContain('is-breaking');

      // 推进定时器（600ms）后完全消隐
      act(() => {
        vi.advanceTimersByTime(650);
      });
      expect(container.querySelector('[data-testid="arena-iron-chain"]')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('3. TargetPointerSvg 多目标连线支持', () => {
    it('支持同时绘制指向两个目标的战术箭头连线', () => {
      const sourcePos: [number, number] = [50, 82]; // 庞统
      const targetPositions: [number, number][] = [
        [24, 17], // 曹操
        [76, 17], // 许褚
      ];

      const { container } = render(
        <TargetPointerSvg
          sourcePos={sourcePos}
          targetPositions={targetPositions}
          variant="chain"
        />
      );

      const svg = container.querySelector('[data-testid="arena-targeting-svg"]');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('data-target-count')).toBe('2');

      // 包含两个目标连线组
      const line0 = svg?.querySelector('[data-testid="arena-target-line-0"]');
      const line1 = svg?.querySelector('[data-testid="arena-target-line-1"]');
      expect(line0).toBeTruthy();
      expect(line1).toBeTruthy();

      // 验证连线坐标起点均为 sourcePos [50, 82]
      const lines = svg?.querySelectorAll('.arena-target-line');
      expect(lines?.length).toBe(2);
      expect(lines?.[0].getAttribute('x1')).toBe('50');
      expect(lines?.[0].getAttribute('y1')).toBe('82');
      expect(lines?.[0].getAttribute('x2')).toBe('24');
      expect(lines?.[0].getAttribute('y2')).toBe('17');

      expect(lines?.[1].getAttribute('x1')).toBe('50');
      expect(lines?.[1].getAttribute('y1')).toBe('82');
      expect(lines?.[1].getAttribute('x2')).toBe('76');
      expect(lines?.[1].getAttribute('y2')).toBe('17');
    });

    it('当 targetPositions 为空时不渲染任何 SVG', () => {
      const { container } = render(
        <TargetPointerSvg sourcePos={[50, 50]} targetPositions={[]} />
      );
      expect(container.querySelector('[data-testid="arena-targeting-svg"]')).toBeNull();
    });
  });

  describe('4. ArenaTable 全局集成：铁链覆层与铁索连环双目标联动', () => {
    it('当角色带有连环标记时，头像上渲染 IronChainOverlay', () => {
      const view = makeTestView({
        players: [
          {
            index: 0,
            name: '玩家1',
            character: '庞统',
            health: 3,
            maxHealth: 3,
            alive: true,
            equipment: {},
            skills: ['连环'],
            handCount: 3,
            hand: [],
            marks: [],
            tags: [],
            identity: '反贼',
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
            marks: [{ id: 'chained', scope: 1 }], // 曹操被铁索连环
            tags: [],
            identity: '主公',
          },
          {
            index: 2,
            name: '玩家3',
            character: '许褚',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: ['裸衣'],
            handCount: 3,
            hand: [],
            marks: [{ id: '横置', scope: 2 }], // 许褚亦被横置
            tags: [],
            identity: '忠臣',
          },
        ],
      });

      const { container } = render(
        <ArenaTable view={view} manifest={makeTestManifest()} assetsReady={true} />
      );

      // 玩家0未横置，不含铁链
      const seat0 = container.querySelector('[data-testid="arena-player-0"]');
      expect(seat0?.querySelector('[data-testid="arena-iron-chain"]')).toBeNull();

      // 玩家1与玩家2均横置，头像上均有实体粗铁链覆层
      const seat1 = container.querySelector('[data-testid="arena-player-1"]');
      expect(seat1?.querySelector('[data-testid="arena-iron-chain"]')).toBeTruthy();

      const seat2 = container.querySelector('[data-testid="arena-player-2"]');
      expect(seat2?.querySelector('[data-testid="arena-iron-chain"]')).toBeTruthy();
    });

    it('出【铁索连环】指定双目标时，同时绘制双箭头连线且两个目标座次均高亮', () => {
      const view = makeTestView({
        currentPlayerIndex: 0,
        settlementStack: [
          {
            skillId: '铁索连环',
            from: 0,
            params: {
              cardId: 'c_chain',
              targets: [1, 2], // 同时指向 曹操(1) 与 许褚(2)
            },
            cards: ['c_chain'],
            cancelled: false,
          },
        ],
      });

      const { container } = render(
        <ArenaTable view={view} manifest={makeTestManifest()} assetsReady={true} />
      );

      // 发起方座位高亮
      const seat0 = container.querySelector('[data-testid="arena-player-0"]');
      expect(seat0?.className).toContain('is-targeting-source');

      // 两个目标方座次均触发锁敌高亮
      const seat1 = container.querySelector('[data-testid="arena-player-1"]');
      const seat2 = container.querySelector('[data-testid="arena-player-2"]');
      expect(seat1?.className).toContain('is-target-locked');
      expect(seat2?.className).toContain('is-target-locked');

      // 渲染多目标虚线指向连线
      const svg = container.querySelector('[data-testid="arena-targeting-svg"]');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('data-target-count')).toBe('2');
      const lines = svg?.querySelectorAll('.arena-target-line');
      expect(lines?.length).toBe(2);
    });

    it('当对局解除连环时，铁链播放断裂动效后消失', () => {
      vi.useFakeTimers();
      const viewChained = makeTestView({
        players: [
          {
            index: 0,
            name: '玩家1',
            character: '庞统',
            health: 3,
            maxHealth: 3,
            alive: true,
            equipment: {},
            skills: ['连环'],
            handCount: 3,
            hand: [],
            marks: [{ id: 'chained', scope: 0 }],
            tags: [],
            identity: '反贼',
          },
        ],
      });

      const { container, rerender } = render(
        <ArenaTable view={viewChained} manifest={makeTestManifest()} assetsReady={true} />
      );

      const seat0 = container.querySelector('[data-testid="arena-player-0"]');
      expect(seat0?.querySelector('[data-testid="arena-iron-chain"]')).toBeTruthy();

      // 移除连环
      const viewUnchained = makeTestView({
        players: [
          {
            index: 0,
            name: '玩家1',
            character: '庞统',
            health: 3,
            maxHealth: 3,
            alive: true,
            equipment: {},
            skills: ['连环'],
            handCount: 3,
            hand: [],
            marks: [],
            tags: [],
            identity: '反贼',
          },
        ],
      });

      rerender(<ArenaTable view={viewUnchained} manifest={makeTestManifest()} assetsReady={true} />);

      // 断裂中
      const breaking = container.querySelector('[data-testid="arena-iron-chain"]');
      expect(breaking).toBeTruthy();
      expect(breaking?.className).toContain('is-breaking');

      // 定时器推移后消隐
      act(() => {
        vi.advanceTimersByTime(650);
      });
      expect(container.querySelector('[data-testid="arena-iron-chain"]')).toBeNull();
      vi.useRealTimers();
    });
  });
});
