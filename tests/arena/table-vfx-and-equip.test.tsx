// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import React from 'react';
import type { GameView, Card } from '../../src/engine/types';
import type { ArenaManifest } from '../../src/arena/types';
import { ArenaTable } from '../../src/client/components/arena/ArenaTable';
import { SlashBladeVfx } from '../../src/client/components/arena/SlashBladeVfx';
import { TargetPointerSvg } from '../../src/client/components/arena/TargetPointerSvg';
import { SkillToast } from '../../src/client/components/arena/SkillToast';

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
      c_chitu: {
        id: 'c_chitu',
        name: '赤兔',
        suit: '♥',
        rank: '5',
        color: 'red',
        type: '装备',
        subtype: 'horse_minus',
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
    id: 'test-match-1',
    name: '测试对局',
    status: 'playing',
    players: [{ id: 'p0', name: '玩家1', mode: 'heuristic' }],
    durationMs: 1000,
    startTime: Date.now(),
    ...overrides,
  } as ArenaManifest;
}

describe('ArenaTable 动效与微缩装备卡面 (Tasks 1-4)', () => {
  describe('1. 装备区微缩 CardFace 呈现', () => {
    it('装备区渲染包含 CardFace 的微缩卡牌，并展示花色、点数与卡名', () => {
      const view = makeTestView({
        players: [
          {
            index: 0,
            name: '玩家1',
            character: '刘备',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {
              武器: 'c_zhuge',
              防具: 'c_bagua',
            },
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
      });

      const { container } = render(
        <ArenaTable view={view} manifest={makeTestManifest()} assetsReady={true} />
      );

      // 玩家0装备卡牌容器
      const equipCardZhuge = container.querySelector('[data-testid="arena-equip-card-c_zhuge"]');
      expect(equipCardZhuge).toBeTruthy();

      // 验证诸葛连弩和八卦阵的微缩卡面信息
      expect(container.textContent).toContain('诸葛连弩');
      expect(container.textContent).toContain('八卦阵');
      expect(container.textContent).toContain('武');
      expect(container.textContent).toContain('防');
    });

    it('未穿戴装备时展示装备未置提示', () => {
      const view = makeTestView();
      const { container } = render(
        <ArenaTable view={view} manifest={makeTestManifest()} assetsReady={true} />
      );
      expect(container.textContent).toContain('装备未置');
    });

    it('装备 id 在 cardMap 中缺失时优雅降级不崩溃', () => {
      const view = makeTestView({
        players: [
          {
            index: 0,
            name: '玩家1',
            character: '关羽',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {
              武器: 'missing_weapon_id',
            },
            skills: ['武圣'],
            handCount: 3,
            hand: [],
            marks: [],
            tags: [],
            identity: '主公',
          },
        ],
      });

      expect(() => {
        render(<ArenaTable view={view} manifest={makeTestManifest()} assetsReady={true} />);
      }).not.toThrow();
    });
  });

  describe('2. 出牌飞入动画 (Card Fly-in)', () => {
    it('当 processing 增加卡牌时，触发从座次飞入中央的卡牌飞行动画', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({
        currentPlayerIndex: 0,
        zones: { deckCount: 50, discardPileCount: 10, processing: [] },
      });

      const { container, rerender } = render(
        <ArenaTable view={view1} manifest={makeTestManifest()} assetsReady={true} />
      );

      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();

      // 出牌：processing 增加 c_sha
      const view2 = makeTestView({
        currentPlayerIndex: 0,
        zones: { deckCount: 50, discardPileCount: 10, processing: ['c_sha'] },
      });

      rerender(<ArenaTable view={view2} manifest={makeTestManifest()} assetsReady={true} />);

      const flyingCard = container.querySelector('[data-testid="arena-flying-card"]');
      expect(flyingCard).toBeTruthy();
      expect(flyingCard?.getAttribute('style')).toContain('--fly-from-x');
      expect(flyingCard?.getAttribute('style')).toContain('--fly-from-y');

      // 动画结束后飞牌自动清理
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelector('[data-testid="arena-flying-card"]')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('3. 目标指向与锁敌虚线连线 (Target Pointer SVG)', () => {
    it('出单体牌指向目标时，发起方高亮、目标红色锁敌高亮，并渲染 TargetPointerSvg 虚线连线', () => {
      const view = makeTestView({
        currentPlayerIndex: 0,
        settlementStack: [
          {
            skillId: '杀',
            from: 0,
            params: {
              cardId: 'c_sha',
              targets: [1],
            },
            cards: ['c_sha'],
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

      // 目标方座位锁敌高亮 (含 seatTargetPulse 动画对应样式类)
      const seat1 = container.querySelector('[data-testid="arena-player-1"]');
      expect(seat1?.className).toContain('is-target-locked');

      // 渲染 SVG 战术虚线箭头
      const svg = container.querySelector('[data-testid="arena-targeting-svg"]');
      expect(svg).toBeTruthy();
      expect(svg?.querySelector('.arena-target-line')).toBeTruthy();
    });
  });

  describe('4. 受击斩击刀光 (SlashBladeVfx)', () => {
    it('当角色体力扣减时，在其头像上展示 SlashBladeVfx 水墨金色月牙刀光', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({
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
          },
        ],
      });

      const { container, rerender } = render(
        <ArenaTable view={view1} manifest={makeTestManifest()} assetsReady={true} />
      );

      expect(container.querySelector('[data-testid="slash-blade-vfx"]')).toBeNull();

      // 玩家1受到伤害扣血
      const view2 = makeTestView({
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
          },
          {
            index: 1,
            name: '玩家2',
            character: '曹操',
            health: 3, // 4 -> 3
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: ['奸雄'],
            handCount: 3,
            hand: [],
            marks: [],
            tags: [],
          },
        ],
      });

      rerender(<ArenaTable view={view2} manifest={makeTestManifest()} assetsReady={true} />);

      const slashBlade = container.querySelector('[data-testid="slash-blade-vfx"]');
      expect(slashBlade).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(container.querySelector('[data-testid="slash-blade-vfx"]')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('5. 统一技能发动横幅 (SkillToast)', () => {
    it('当武将发动技能时，在对应座次上方弹出水墨金边横幅', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({
        log: [],
      });

      const { container, rerender } = render(
        <ArenaTable view={view1} manifest={makeTestManifest()} assetsReady={true} />
      );

      expect(container.querySelector('[data-testid="arena-skill-toast"]')).toBeNull();

      // 玩家0刘备发动【仁德】
      const view2 = makeTestView({
        log: [{ time: 100, player: 0, text: '发动【仁德】' }],
      });

      rerender(<ArenaTable view={view2} manifest={makeTestManifest()} assetsReady={true} />);

      const toast = container.querySelector('[data-testid="arena-skill-toast"]');
      expect(toast).toBeTruthy();
      expect(toast?.textContent).toContain('〔仁德〕· 刘备');

      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(container.querySelector('[data-testid="arena-skill-toast"]')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('6. 动效基础组件单元检验', () => {
    it('SlashBladeVfx 包含月牙路径与光晕定义', () => {
      const { container } = render(<SlashBladeVfx />);
      expect(container.querySelector('svg.arena-slash-svg')).toBeTruthy();
      expect(container.querySelector('path.arena-slash-path')).toBeTruthy();
    });

    it('TargetPointerSvg 绘制从源到目标的战术连线与箭头', () => {
      const { container } = render(
        <TargetPointerSvg sourcePos={[50, 82]} targetPositions={[[50, 17], [14, 48]]} />
      );
      const lines = container.querySelectorAll('line.arena-target-line');
      expect(lines).toHaveLength(2);
    });

    it('SkillToast 呈现标准规范文本格式', () => {
      const { container } = render(<SkillToast skillName="奸雄" characterName="曹操" />);
      expect(container.textContent).toContain('〔奸雄〕· 曹操');
    });
  });
});
