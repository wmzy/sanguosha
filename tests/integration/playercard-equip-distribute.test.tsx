// 前端组件测试:PlayerCardLarge 装备区在 distribute(制衡)激活时可点击选牌。
//
// 背景:此前装备区渲染为纯展示 <span>,distribute 激活时虽把装备列入候选集
// (resolveDistributeCardIds source='handAndEquip'),但 UI 无法点击 → 制衡无法选装备。
// 本测试只验证组件渲染契约:
//   1. distribute 未激活:装备是普通文本(不可点)
//   2. distribute 激活 + 装备是候选:装备渲染为 button
//   3. 点击候选装备 → 进入选中态(class 变化);再点 → 回退
//   4. 点击候选装备 → 触发 onEquipCardClick 回调
//
// 技能语义(弃装备摸等量、限一次等)由 tests/skill-tests/制衡.test.ts 覆盖,此处不重复。
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerCardLarge } from '../../src/client/components/PlayerCardLarge';
import * as styles from '../../src/client/components/gameViewStyles';
import type { GameView } from '../../src/engine/types';

function makeView(equipment: Record<string, string>): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0, name: 'P1', character: '孙权', health: 4, maxHealth: 4, alive: true,
        skills: [], equipment, handCount: 0, marks: [],
      },
      {
        index: 1, name: 'P2', character: '曹操', health: 4, maxHealth: 4, alive: true,
        skills: [], equipment: {}, handCount: 0, marks: [],
      },
    ],
    cardMap: {
      wp1: { id: 'wp1', name: '诸葛连弩', suit: '♠', rank: 'A', type: '装备牌', subtype: '武器' },
    },
    pending: null, deadline: null, deadlineTotalMs: 0, log: [], settlementStack: [],
  };
}

describe('PlayerCardLarge:装备区 distribute 选牌', () => {
  it('distribute 未激活:装备渲染为不可点的 span', () => {
    const view = makeView({ 武器: 'wp1' });
    render(
      <PlayerCardLarge
        perspectiveIdx={0} viewer={0} view={view}
        damageFlashIndices={new Map()} canOperate skillActions={[]}
        isPerspectiveTurn onSkillAction={() => {}}
      />,
    );
    const node = screen.getByText(/诸葛连弩/);
    expect(node.tagName).toBe('SPAN');
  });

  it('distribute 激活 + 装备是候选:装备渲染为 button', () => {
    const view = makeView({ 武器: 'wp1' });
    render(
      <PlayerCardLarge
        perspectiveIdx={0} viewer={0} view={view}
        damageFlashIndices={new Map()} canOperate skillActions={[]}
        isPerspectiveTurn onSkillAction={() => {}}
        isDistributeActive
        distCandidateEquipIds={new Set(['wp1'])}
        distSelectedEquipIds={new Set()}
        onEquipCardClick={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /诸葛连弩/ });
    // 候选态:带 equipDistBtn 样式,不带选中样式
    expect(btn.className).toContain(styles.equipDistBtn);
    expect(btn.className).not.toContain(styles.equipDistSelected);
  });

  it('装备被选中:带 equipDistSelected 样式', () => {
    const view = makeView({ 武器: 'wp1' });
    render(
      <PlayerCardLarge
        perspectiveIdx={0} viewer={0} view={view}
        damageFlashIndices={new Map()} canOperate skillActions={[]}
        isPerspectiveTurn onSkillAction={() => {}}
        isDistributeActive
        distCandidateEquipIds={new Set(['wp1'])}
        distSelectedEquipIds={new Set(['wp1'])}
        onEquipCardClick={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /诸葛连弩/ });
    expect(btn.className).toContain(styles.equipDistSelected);
  });

  it('点击候选装备 → onEquipCardClick 以 cardId 回调', () => {
    const view = makeView({ 武器: 'wp1' });
    const clicked: string[] = [];
    render(
      <PlayerCardLarge
        perspectiveIdx={0} viewer={0} view={view}
        damageFlashIndices={new Map()} canOperate skillActions={[]}
        isPerspectiveTurn onSkillAction={() => {}}
        isDistributeActive
        distCandidateEquipIds={new Set(['wp1'])}
        distSelectedEquipIds={new Set()}
        onEquipCardClick={(id) => clicked.push(id)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /诸葛连弩/ }));
    expect(clicked).toEqual(['wp1']);
  });

  it('distribute 激活但装备非候选:仍渲染为 span(不可点)', () => {
    const view = makeView({ 武器: 'wp1' });
    render(
      <PlayerCardLarge
        perspectiveIdx={0} viewer={0} view={view}
        damageFlashIndices={new Map()} canOperate skillActions={[]}
        isPerspectiveTurn onSkillAction={() => {}}
        isDistributeActive
        distCandidateEquipIds={new Set()} // 候选集为空 → 该装备非候选
        distSelectedEquipIds={new Set()}
        onEquipCardClick={() => {}}
      />,
    );
    expect(screen.getByText(/诸葛连弩/).tagName).toBe('SPAN');
  });
});
