// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import React from 'react';
import type { GameView, Card } from '../../src/engine/types';
import type { ArenaManifest } from '../../src/arena/types';
import { ArenaTable, detectEquipTrigger, formatEquipBadge } from '../../src/client/components/arena/ArenaTable';
import { GrandSkillBanner } from '../../src/client/components/arena/GrandSkillBanner';

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
        character: '孙权',
        faction: '吴',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {
          武器: 'c_qinglong',
          防具: 'c_bagua',
        },
        skills: ['界制衡'],
        handCount: 3,
        hand: [],
        marks: [],
        tags: [],
        identity: '主公',
      },
      {
        index: 1,
        name: '玩家2',
        character: '关羽',
        faction: '蜀',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {
          武器: 'c_zhangba',
          防具: 'c_renwang',
        },
        skills: ['义绝'],
        handCount: 3,
        hand: [],
        marks: [],
        tags: [],
        identity: '反贼',
      },
    ],
    cardMap: {
      c_bagua: {
        id: 'c_bagua',
        name: '八卦阵',
        suit: '♠',
        rank: '2',
        color: 'black',
        type: '装备',
        subtype: 'armor',
      } as unknown as Card,
      c_qinglong: {
        id: 'c_qinglong',
        name: '青龙偃月刀',
        suit: '♠',
        rank: '5',
        color: 'black',
        type: '装备',
        subtype: 'weapon',
      } as unknown as Card,
      c_renwang: {
        id: 'c_renwang',
        name: '仁王盾',
        suit: '♣',
        rank: '2',
        color: 'black',
        type: '装备',
        subtype: 'armor',
      } as unknown as Card,
      c_tengjia: {
        id: 'c_tengjia',
        name: '藤甲',
        suit: '♠',
        rank: '2',
        color: 'black',
        type: '装备',
        subtype: 'armor',
      } as unknown as Card,
      c_zhangba: {
        id: 'c_zhangba',
        name: '丈八蛇矛',
        suit: '♠',
        rank: 'Q',
        color: 'black',
        type: '装备',
        subtype: 'weapon',
      } as unknown as Card,
      c_shizi: {
        id: 'c_shizi',
        name: '白银狮子',
        suit: '♣',
        rank: 'A',
        color: 'black',
        type: '装备',
        subtype: 'armor',
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
    id: 'test-match-grand',
    name: '测试对局-大特写与装备流光',
    status: 'playing',
    players: [{ id: 'p0', name: '玩家1', mode: 'heuristic' }],
    durationMs: 1000,
    startTime: Date.now(),
    ...overrides,
  } as ArenaManifest;
}

describe('Tasks 3 & 4: 电影级黑金水墨技能大特写与装备牌触发流光提示', () => {
  describe('Task 3: GrandSkillBanner (电影级技能大特写)', () => {
    it('1. GrandSkillBanner 渲染武将切片立绘圆环、烫金毛笔大字技能名与水墨冲击波', () => {
      const { container } = render(
        <GrandSkillBanner
          skill={{
            skillName: '界制衡',
            characterName: '孙权',
            faction: '吴',
          }}
        />
      );

      const banner = container.querySelector('[data-testid="grand-skill-banner"]');
      expect(banner).toBeTruthy();

      // 验证 pointer-events: none
      expect((banner as HTMLElement).style.pointerEvents).toBe('none');

      // 验证金环与武将头像容器
      expect(container.querySelector('.grand-skill-gold-ring')).toBeTruthy();
      expect(container.querySelector('.grand-skill-avatar-wrap')).toBeTruthy();

      // 验证水墨气劲冲击波 SVG
      expect(container.querySelector('.grand-skill-ink-svg')).toBeTruthy();
      expect(container.querySelector('.grand-shockwave-wave')).toBeTruthy();

      // 验证烫金毛笔大字技能名格式（带字间距空格的霸气大字）
      const skillNameEl = container.querySelector('[data-testid="grand-skill-name"]');
      expect(skillNameEl).toBeTruthy();
      expect(skillNameEl?.textContent).toContain('〔 界 制 衡 〕');

      // 验证武将名与势力
      expect(container.textContent).toContain('孙权');
      expect(container.textContent).toContain('吴');
      expect(container.textContent).toContain('绝技发动');
    });

    it('2. GrandSkillBanner 在持续 1.8s 后自动平滑淡出', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      const { container } = render(
        <GrandSkillBanner
          skill={{
            skillName: '义绝',
            characterName: '关羽',
            faction: '蜀',
          }}
          duration={1800}
          onDismiss={onDismiss}
        />
      );

      expect(container.querySelector('[data-testid="grand-skill-banner"]')).toBeTruthy();

      // 1.8 秒后淡出并触发 onDismiss
      act(() => {
        vi.advanceTimersByTime(1800);
      });

      expect(onDismiss).toHaveBeenCalled();
      expect(container.querySelector('[data-testid="grand-skill-banner"]')).toBeNull();
      vi.useRealTimers();
    });

    it('3. GrandSkillBanner 支持连续发动平滑排队展示', () => {
      vi.useFakeTimers();
      const dismissed: string[] = [];
      const queue = [
        { id: '1', skillName: '界制衡', characterName: '孙权', faction: '吴' },
        { id: '2', skillName: '义绝', characterName: '关羽', faction: '蜀' },
      ];

      const { container } = render(
        <GrandSkillBanner
          queue={queue}
          duration={1800}
          onDismiss={(item) => dismissed.push(item.skillName)}
        />
      );

      // 首先展示队列第一个：界制衡
      expect(container.querySelector('[data-testid="grand-skill-name"]')?.textContent).toContain('〔 界 制 衡 〕');
      expect(container.textContent).toContain('孙权');

      // 经过 1.8 秒，界制衡结束，自动无缝切换到第二个：义绝
      act(() => {
        vi.advanceTimersByTime(1800);
      });
      expect(dismissed).toContain('界制衡');
      expect(container.querySelector('[data-testid="grand-skill-name"]')?.textContent).toContain('〔 义 绝 〕');
      expect(container.textContent).toContain('关羽');

      // 再过 1.8 秒，义绝结束，横幅自然清理
      act(() => {
        vi.advanceTimersByTime(1800);
      });
      expect(dismissed).toContain('义绝');
      expect(container.querySelector('[data-testid="grand-skill-banner"]')).toBeNull();
      vi.useRealTimers();
    });

    it('4. 在 ArenaTable 中由日志触发 GrandSkillBanner 大特写并自动销毁', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({ log: [] });
      const { container, rerender } = render(
        <ArenaTable view={view1} manifest={makeTestManifest()} assetsReady={true} />
      );

      expect(container.querySelector('[data-testid="grand-skill-banner"]')).toBeNull();

      // 玩家0孙权发动【界制衡】
      const view2 = makeTestView({
        log: [{ time: 100, player: 0, text: '发动【界制衡】' }],
      });

      rerender(<ArenaTable view={view2} manifest={makeTestManifest()} assetsReady={true} />);

      const banner = container.querySelector('[data-testid="grand-skill-banner"]');
      expect(banner).toBeTruthy();
      expect(container.querySelector('[data-testid="grand-skill-name"]')?.textContent).toContain('〔 界 制 衡 〕');

      // 1.8s 后自动清理
      act(() => {
        vi.advanceTimersByTime(1800);
      });
      expect(container.querySelector('[data-testid="grand-skill-banner"]')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('Task 4: 装备牌触发反馈 (Equip Trigger Feedback)', () => {
    it('1. 八卦阵判定触发：对应防具微缩卡面触发 is-equip-triggered 炫金流光，并弹出【八卦阵】判定生效气泡', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({ log: [] });
      const { container, rerender } = render(
        <ArenaTable view={view1} manifest={makeTestManifest()} assetsReady={true} />
      );

      // 初始无装备触发流光和气泡
      expect(container.querySelector('.arena-equip-card.is-equip-triggered')).toBeNull();
      expect(container.querySelector('[data-testid="arena-equip-bubble"]')).toBeNull();

      // 玩家0触发八卦阵判定生效
      const view2 = makeTestView({
        log: [{ time: 100, player: 0, text: '【八卦阵】判定生效' }],
      });

      rerender(<ArenaTable view={view2} manifest={makeTestManifest()} assetsReady={true} />);

      // 八卦阵装备卡面带有 is-equip-triggered 炫金脉冲高亮类
      const equipCard = container.querySelector('[data-testid="arena-equip-card-c_bagua"]');
      expect(equipCard).toBeTruthy();
      expect(equipCard?.className).toContain('is-equip-triggered');

      // 装备槽位上方弹出悬浮微标气泡
      const bubble = container.querySelector('[data-testid="arena-equip-bubble"]');
      expect(bubble).toBeTruthy();
      expect(bubble?.textContent).toBe('【八卦阵】判定生效');

      // 持续 1.5s 后渐隐清除
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(container.querySelector('.arena-equip-card.is-equip-triggered')).toBeNull();
      expect(container.querySelector('[data-testid="arena-equip-bubble"]')).toBeNull();
      vi.useRealTimers();
    });

    it('2. 青龙偃月刀追杀触发：对应武器栏微缩卡面高亮并弹出【青龙偃月刀】追杀气泡', () => {
      vi.useFakeTimers();
      const view1 = makeTestView({ log: [] });
      const { container, rerender } = render(
        <ArenaTable view={view1} manifest={makeTestManifest()} assetsReady={true} />
      );

      // 玩家0触发青龙偃月刀追杀
      const view2 = makeTestView({
        log: [{ time: 100, player: 0, text: '发动【青龙偃月刀】追杀' }],
      });

      rerender(<ArenaTable view={view2} manifest={makeTestManifest()} assetsReady={true} />);

      const equipCard = container.querySelector('[data-testid="arena-equip-card-c_qinglong"]');
      expect(equipCard).toBeTruthy();
      expect(equipCard?.className).toContain('is-equip-triggered');

      const bubble = container.querySelector('[data-testid="arena-equip-bubble"]');
      expect(bubble).toBeTruthy();
      expect(bubble?.textContent).toBe('【青龙偃月刀】追杀');
      vi.useRealTimers();
    });

    it('3. 仁王盾挡黑杀触发：自动定位被攻击方装备座次并弹出【仁王盾】挡黑杀气泡', () => {
      vi.useFakeTimers();
      // 玩家0出杀，玩家1仁王盾挡下
      const view1 = makeTestView({ log: [] });
      const { container, rerender } = render(
        <ArenaTable view={view1} manifest={makeTestManifest()} assetsReady={true} />
      );

      const view2 = makeTestView({
        log: [{ time: 100, player: 0, text: '黑色杀对【仁王盾】无效，【仁王盾】挡黑杀' }],
      });

      rerender(<ArenaTable view={view2} manifest={makeTestManifest()} assetsReady={true} />);

      // 验证定位到了拥有仁王盾的玩家1（关羽）的装备卡
      const equipCard = container.querySelector('[data-testid="arena-equip-card-c_renwang"]');
      expect(equipCard).toBeTruthy();
      expect(equipCard?.className).toContain('is-equip-triggered');

      const bubble = container.querySelector('[data-testid="arena-equip-bubble"]');
      expect(bubble).toBeTruthy();
      expect(bubble?.textContent).toBe('【仁王盾】挡黑杀');
      vi.useRealTimers();
    });

    it('4. 藤甲、丈八蛇矛与白银狮子等装备触发文案精准识别', () => {
      const view = makeTestView({
        players: [
          {
            index: 0,
            name: '玩家1',
            character: '孙权',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {
              武器: 'c_zhangba',
              防具: 'c_tengjia',
            },
            skills: [],
            handCount: 3,
            hand: [],
            marks: [],
            tags: [],
          },
          {
            index: 1,
            name: '玩家2',
            character: '关羽',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {
              防具: 'c_shizi',
            },
            skills: [],
            handCount: 3,
            hand: [],
            marks: [],
            tags: [],
          },
        ],
      });

      // 藤甲免普伤
      const tengjiaTrigger = detectEquipTrigger('【藤甲】免普伤', view, 0);
      expect(tengjiaTrigger).not.toBeNull();
      expect(tengjiaTrigger?.slot).toBe('防具');
      expect(tengjiaTrigger?.badge).toBe('【藤甲】免普伤');

      // 丈八蛇矛两张当杀
      const zhangbaTrigger = detectEquipTrigger('【丈八蛇矛】两张当杀', view, 0);
      expect(zhangbaTrigger).not.toBeNull();
      expect(zhangbaTrigger?.slot).toBe('武器');
      expect(zhangbaTrigger?.badge).toBe('【丈八蛇矛】两张当杀');

      // 白银狮子回血
      const shiziTrigger = detectEquipTrigger('失去【白银狮子】回血', view, 1);
      expect(shiziTrigger).not.toBeNull();
      expect(shiziTrigger?.slot).toBe('防具');
      expect(shiziTrigger?.badge).toBe('【白银狮子】回血');
    });

    it('5. 纯文本 formatEquipBadge 规则测试', () => {
      expect(formatEquipBadge('八卦阵', '判定生效')).toBe('【八卦阵】判定生效');
      expect(formatEquipBadge('青龙偃月刀', '发动追击')).toBe('【青龙偃月刀】追击');
      expect(formatEquipBadge('仁王盾', '')).toBe('【仁王盾】挡黑杀');
      expect(formatEquipBadge('白银狮子', '回复1点体力')).toBe('【白银狮子】回血');
      expect(formatEquipBadge('诸葛连弩', '')).toBe('【诸葛连弩】连续出杀');
    });
  });
});
