// 前端组件测试:EquipColumn 装备区在 distribute(制衡)激活时可点击选牌。
//
// 背景:此前装备区渲染为纯展示文本,distribute 激活时虽把装备列入候选集
// (resolveDistributeCardIds source='handAndEquip'),但 UI 无法点击 → 制衡无法选装备。
// 装备区已从 PlayerCardLarge 抽出为独立的纵向 EquipColumn 组件,本测试验证其渲染契约:
//   1. distribute 未激活:装备是普通文本(不可点)
//   2. distribute 激活 + 装备是候选:装备渲染为 button
//   3. 点击候选装备 → 进入选中态(class 变化);再点 → 回退
//   4. 点击候选装备 → 触发 onEquipCardClick 回调
//
// 技能语义(弃装备摸等量、限一次等)由 tests/skill-tests/制衡.test.ts 覆盖,此处不重复。
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EquipColumn } from '../../src/client/components/EquipColumn';
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
        index: 0,
        name: 'P1',
        character: '孙权',
        health: 4,
        maxHealth: 4,
        alive: true,
        skills: [],
        equipment,
        handCount: 0,
        marks: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: true,
        skills: [],
        equipment: {},
        handCount: 0,
        marks: [],
      },
    ],
    cardMap: {
      wp1: {
        id: 'wp1',
        name: '诸葛连弩',
        suit: '♠',
        color: '黑',
        rank: 'A',
        type: '装备牌',
        subtype: '武器',
      },
    },
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

describe('EquipColumn:装备区 distribute 选牌', () => {
  it('distribute 未激活:装备渲染为不可点的文本', () => {
    const view = makeView({ 武器: 'wp1' });
    render(
      <EquipColumn
        perspectiveIdx={0}
        view={view}
        canOperate
        skillActions={[]}
        onSkillAction={() => {}}
      />,
    );
    const node = screen.getByText(/诸葛连弩/);
    // 非候选装备渲染为 equipColumnItem 内的文本 span,不可点击
    expect(node.tagName).toBe('SPAN');
    expect(node.closest('[role="button"]')).toBeNull();
  });

  it('distribute 激活 + 装备是候选:装备渲染为 button', () => {
    const view = makeView({ 武器: 'wp1' });
    render(
      <EquipColumn
        perspectiveIdx={0}
        view={view}
        canOperate
        skillActions={[]}
        onSkillAction={() => {}}
        isDistributeActive
        distCandidateEquipIds={new Set(['wp1'])}
        distSelectedEquipIds={new Set()}
        onEquipCardClick={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /诸葛连弩/ });
    // 候选态:带 equipDistBtn 样式,不带选中样式
    expect(btn.className).toContain(styles.equipDistCandidate);
    expect(btn.className).not.toContain(styles.equipSelected);
  });

  it('装备被选中:带 equipDistSelected 样式', () => {
    const view = makeView({ 武器: 'wp1' });
    render(
      <EquipColumn
        perspectiveIdx={0}
        view={view}
        canOperate
        skillActions={[]}
        onSkillAction={() => {}}
        isDistributeActive
        distCandidateEquipIds={new Set(['wp1'])}
        distSelectedEquipIds={new Set(['wp1'])}
        onEquipCardClick={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /诸葛连弩/ });
    expect(btn.className).toContain(styles.equipSelected);
  });

  it('点击候选装备 → onEquipCardClick 以 cardId 回调', () => {
    const view = makeView({ 武器: 'wp1' });
    const clicked: string[] = [];
    render(
      <EquipColumn
        perspectiveIdx={0}
        view={view}
        canOperate
        skillActions={[]}
        onSkillAction={() => {}}
        isDistributeActive
        distCandidateEquipIds={new Set(['wp1'])}
        distSelectedEquipIds={new Set()}
        onEquipCardClick={(id) => clicked.push(id)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /诸葛连弩/ }));
    expect(clicked).toEqual(['wp1']);
  });

  it('distribute 激活但装备非候选:仍渲染为文本(不可点)', () => {
    const view = makeView({ 武器: 'wp1' });
    render(
      <EquipColumn
        perspectiveIdx={0}
        view={view}
        canOperate
        skillActions={[]}
        onSkillAction={() => {}}
        isDistributeActive
        distCandidateEquipIds={new Set()} // 候选集为空 → 该装备非候选
        distSelectedEquipIds={new Set()}
        onEquipCardClick={() => {}}
      />,
    );
    expect(screen.getByText(/诸葛连弩/).closest('[role="button"]')).toBeNull();
  });

  // ── 固定槽位:空槽显示占位卡框(布局稳定,不因装备数变化而抖动) ──
  it('完全无装备:5 个槽位均渲染为空占位卡框', () => {
    const view = makeView({});
    render(
      <EquipColumn
        perspectiveIdx={0}
        view={view}
        canOperate
        skillActions={[]}
        onSkillAction={() => {}}
      />,
    );
    for (const slot of ['武器', '防具', '进攻马', '防御马', '宝物']) {
      const label = screen.getByText(slot);
      expect(label.className).toContain(styles.equipSlotEmptyLabel);
      expect(label.parentElement?.className).toContain(styles.equipSlotEmpty);
    }
  });

  it('部分装备:有装备的槽显示装备名,空槽显示占位', () => {
    const view = makeView({ 武器: 'wp1' });
    render(
      <EquipColumn
        perspectiveIdx={0}
        view={view}
        canOperate
        skillActions={[]}
        onSkillAction={() => {}}
      />,
    );
    // 武器槽显示装备名(非占位) → 不显示“武器”占位文本
    expect(screen.queryByText('武器')).toBeNull();
    expect(screen.getByText(/诸葛连弩/).tagName).toBe('SPAN');
    // 其余 4 槽为空占位
    for (const slot of ['防具', '进攻马', '防御马', '宝物']) {
      expect(screen.getByText(slot).className).toContain(styles.equipSlotEmptyLabel);
    }
  });
});
