// @vitest-environment jsdom
// UI 渲染层诊断:模拟回放连续多个 step,验证 PlayerSeatView/PlayerCardLarge 装备文本
// 是否随 view 变化更新。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameViewComponent } from '../../../src/client/components/GameView';
import { clearRegistry } from '../../../src/client/skillActionRegistry';
import type { GameView, Card } from '../../../src/engine/types';

function makeEquipCard(id: string, name: string, subtype: string): Card {
  return { id, name, suit: '♠', color: '黑', rank: 'A', type: '装备牌', subtype };
}

function makeView(p0Equip: Record<string, string>, p1Equip: Record<string, string>): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0, name: 'P0', character: '刘备', health: 4, maxHealth: 4, alive: true,
        equipment: p0Equip, skills: [], handCount: 0, marks: [],
      },
      {
        index: 1, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: true,
        equipment: p1Equip, skills: [], handCount: 0, marks: [],
      },
    ],
    cardMap: { 'wp-zg': makeEquipCard('wp-zg', '诸葛连弩', '武器') },
    pending: null, deadline: null, deadlineTotalMs: 0, log: [], settlementStack: [],
  };
}

describe('回放 UI 渲染:装备随 step 变化', () => {
  beforeEach(() => { clearRegistry(); });

  it('P0 视角大卡:无装备 → 有武器 → 无装备 正确切换', () => {
    const v0 = makeView({}, {});
    const v2 = makeView({ 武器: 'wp-zg' }, {});
    const { rerender } = render(<GameViewComponent view={v0} onAction={() => {}} readOnly />);
    expect(screen.queryByText('诸葛连弩')).toBeNull();
    rerender(<GameViewComponent view={v2} onAction={() => {}} readOnly />);
    expect(screen.getAllByText('诸葛连弩').length).toBeGreaterThan(0);
    rerender(<GameViewComponent view={v0} onAction={() => {}} readOnly />);
    expect(screen.queryByText('诸葛连弩')).toBeNull();
  });

  it('P1 座位卡:无装备 → 有武器 → 无装备 rerender 正确切换', () => {
    const v0 = makeView({}, {});
    const v1 = makeView({}, { 武器: 'wp-zg' });
    const { container, rerender } = render(<GameViewComponent view={v0} onAction={() => {}} readOnly />);
    // step 0:无装备
    let titles = Array.from(container.querySelectorAll('[title]')).map(e => (e as HTMLElement).getAttribute('title'));
    expect(titles).not.toContain('诸葛连弩(武器)');

    // step 1:有武器
    rerender(<GameViewComponent view={v1} onAction={() => {}} readOnly />);
    titles = Array.from(container.querySelectorAll('[title]')).map(e => (e as HTMLElement).getAttribute('title'));
    expect(titles).toContain('诸葛连弩(武器)');

    // 切回无装备
    rerender(<GameViewComponent view={v0} onAction={() => {}} readOnly />);
    titles = Array.from(container.querySelectorAll('[title]')).map(e => (e as HTMLElement).getAttribute('title'));
    expect(titles).not.toContain('诸葛连弩(武器)');
  });
});

// 横置(铁索连环)前端展示:chained mark → 座位卡/大卡显示 ⛓ 徽章,
// 且原始标记名 'chained' 不再以纯文本泄漏到 marks 行。
function makeChainView(chainedSeats: number[]): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0, name: 'P0', character: '刘备', health: 4, maxHealth: 4, alive: true,
        equipment: {}, skills: [], handCount: 0,
        marks: chainedSeats.includes(0) ? [{ id: 'chained', scope: 0 }] : [],
      },
      {
        index: 1, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: true,
        equipment: {}, skills: [], handCount: 0,
        marks: chainedSeats.includes(1) ? [{ id: 'chained', scope: 1 }] : [],
      },
    ],
    cardMap: {},
    pending: null, deadline: null, deadlineTotalMs: 0, log: [], settlementStack: [],
  };
}

describe('横置(铁索连环)前端展示', () => {
  beforeEach(() => { clearRegistry(); });

  it('P1 座位卡被横置:显示 ⛓ 徽章,且不泄漏原始 chained 文本', () => {
    const { container } = render(
      <GameViewComponent view={makeChainView([1])} onAction={() => {}} readOnly />,
    );
    const badge = container.querySelector('[title="横置·铁索连环"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('⛓');
    // 原始标记名 'chained' 不应作为纯文本出现在 marks 行
    expect(screen.queryByText('chained')).toBeNull();
  });

  it('未横置时不显示连环徽章', () => {
    const { container } = render(
      <GameViewComponent view={makeChainView([])} onAction={() => {}} readOnly />,
    );
    expect(container.querySelector('[title="横置·铁索连环"]')).toBeNull();
  });

  it('P0 视角大卡(自己)被横置:大卡也显示 ⛓ 徽章', () => {
    const { container } = render(
      <GameViewComponent view={makeChainView([0])} onAction={() => {}} readOnly />,
    );
    const badges = container.querySelectorAll('[title="横置·铁索连环"]');
    // 视角玩家自身为大卡,至少一个徽章
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });
});

// 体力珠列展示(2026-08-24 对齐官方):损失的体力(空珠)在上方、剩余体力(满珠)在下方,
// 满珠按剩余体力比例分色(>50% 绿 / >25% 黄 / ≤25% 红)。
// p0Health:视角玩家 P0(底栏大卡)的体力,默认满血(既有座位卡用例只调 P1)。
function makeHpView(health: number, maxHealth: number, p0Health: number = 4): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0, name: 'P0', character: '刘备', health: p0Health, maxHealth: 4, alive: true,
        equipment: {}, skills: [], handCount: 0, marks: [],
      },
      {
        index: 1, name: 'P1', character: '曹操', health, maxHealth, alive: true,
        equipment: {}, skills: [], handCount: 0, marks: [],
      },
    ],
    cardMap: {},
    pending: null, deadline: null, deadlineTotalMs: 0, log: [], settlementStack: [],
  };
}

describe('体力珠列方向与分色', () => {
  beforeEach(() => { clearRegistry(); });

  /** 取 P1 座位卡的珠列(每颗珠的 data 属性,自上而下) */
  function beads(container: HTMLElement): Array<{ full: boolean; hue: string | null }> {
    const seat = Array.from(container.querySelectorAll('[data-player-name]'))
      .find((s) => s.getAttribute('data-player-name') === 'P1')!;
    const col = seat.querySelector('[data-hp-beads]')!;
    return Array.from(col.children).map((b) => ({
      full: b.hasAttribute('data-full'),
      hue: b.getAttribute('data-hue'),
    }));
  }

  it('满血:全部满珠(绿色)', () => {
    const { container } = render(<GameViewComponent view={makeHpView(4, 4)} onAction={() => {}} readOnly />);
    const bs = beads(container);
    expect(bs).toHaveLength(4);
    expect(bs.every((b) => b.full && b.hue === 'green')).toBe(true);
  });

  it('受伤:空珠在上、满珠在下', () => {
    const { container } = render(<GameViewComponent view={makeHpView(2, 4)} onAction={() => {}} readOnly />);
    const bs = beads(container);
    expect(bs).toHaveLength(4);
    // 前 2 颗(上方)= 空珠;后 2 颗(下方)= 满珠
    expect(bs.map((b) => b.full)).toEqual([false, false, true, true]);
  });

  it('分色:剩余比例递减 → 绿(>50%) → 黄(>25%) → 红(≤25%)', () => {
    const render4 = (health: number) => {
      const utils = render(<GameViewComponent view={makeHpView(health, 4)} onAction={() => {}} readOnly />);
      const hue = beads(utils.container).find((b) => b.full)!.hue;
      utils.unmount();
      return hue;
    };
    expect(render4(4)).toBe('green'); // 4/4 = 100%
    expect(render4(2)).toBe('yellow'); // 2/4 = 50%
    expect(render4(1)).toBe('red'); // 1/4 = 25%
  });

  /** 取 P0(视角玩家)底栏大卡的珠列:大卡外层挂 data-seat-index=0
   *  (弧形座位环只渲染 orderedPlayers.slice(1),视角玩家自己不进环,故该选择器唯一) */
  function largeCardBeads(container: HTMLElement): Array<{ full: boolean; hue: string | null }> {
    const card = container.querySelector('[data-seat-index="0"]')!;
    const col = card.querySelector('[data-hp-beads]')!;
    return Array.from(col.children).map((b) => ({
      full: b.hasAttribute('data-full'),
      hue: b.getAttribute('data-hue'),
    }));
  }

  it('大卡(自己)受伤:空珠在上、满珠在下', () => {
    const { container } = render(<GameViewComponent view={makeHpView(4, 4, 2)} onAction={() => {}} readOnly />);
    const bs = largeCardBeads(container);
    expect(bs).toHaveLength(4);
    // 前 2 颗(上方)= 空珠;后 2 颗(下方)= 满珠 —— 与座位卡同方向
    expect(bs.map((b) => b.full)).toEqual([false, false, true, true]);
  });

  it('大卡(自己)分色:剩余比例递减 → 绿 → 黄 → 红(与座位卡同规则)', () => {
    const renderP0 = (p0Health: number) => {
      const utils = render(<GameViewComponent view={makeHpView(4, 4, p0Health)} onAction={() => {}} readOnly />);
      const hue = largeCardBeads(utils.container).find((b) => b.full)!.hue;
      utils.unmount();
      return hue;
    };
    expect(renderP0(4)).toBe('green'); // 4/4 = 100%
    expect(renderP0(2)).toBe('yellow'); // 2/4 = 50%
    expect(renderP0(1)).toBe('red'); // 1/4 = 25%
  });
});
