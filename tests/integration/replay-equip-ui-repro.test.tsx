// @vitest-environment jsdom
// UI 渲染层诊断:模拟回放连续多个 step,验证 PlayerSeatView/PlayerCardLarge 装备文本
// 是否随 view 变化更新。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView, Card } from '../../src/engine/types';

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
    console.log('step0 titles:', titles);
    expect(titles).not.toContain('诸葛连弩(武器)');

    // step 1:有武器
    rerender(<GameViewComponent view={v1} onAction={() => {}} readOnly />);
    titles = Array.from(container.querySelectorAll('[title]')).map(e => (e as HTMLElement).getAttribute('title'));
    console.log('step1 titles:', titles);
    expect(titles).toContain('诸葛连弩(武器)');

    // 切回无装备
    rerender(<GameViewComponent view={v0} onAction={() => {}} readOnly />);
    titles = Array.from(container.querySelectorAll('[title]')).map(e => (e as HTMLElement).getAttribute('title'));
    console.log('step0again titles:', titles);
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
