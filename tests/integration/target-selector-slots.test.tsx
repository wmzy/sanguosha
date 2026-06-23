// TargetSelector slots 渲染测试:
//   - 有 slots(借刀杀人 A+B):分两步渲染,B 槽位依赖 A 的攻击范围
//   - 无 slots(单目标):渲染单个目标列表
//   - selfTarget(桃):不渲染目标选择(由父组件控制,这里测 targetFilter 逻辑)
//
// 验证 slots 架构:多目标规则从 prompt.targetFilter.slots 派生,不再依赖 TWO_TARGET_CARDS。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TargetSelector } from '../../src/client/components/TargetSelector';
import type { GameView, Card, TargetFilter } from '../../src/engine/types';

function makeCard(id: string, name: string, type: Card['type'] = '基本牌'): Card {
  return { id, name, suit: '♠', rank: 'A', type };
}

function makeView(): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      { index: 0, name: 'P0', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: [], handCount: 0, equipment: { '武器': 'wp0' }, skills: [], vars: {}, marks: [], distanceVars: { attackRange: 1 } },
      { index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4, alive: true, hand: [], handCount: 0, equipment: { '武器': 'wp1' }, skills: [], vars: {}, marks: [], distanceVars: { attackRange: 1 } },
      { index: 2, name: 'P2', character: '关羽', health: 4, maxHealth: 4, alive: true, hand: [], handCount: 0, equipment: {}, skills: [], vars: {}, marks: [], distanceVars: { attackRange: 1 } },
      { index: 3, name: 'P3', character: '赵云', health: 4, maxHealth: 4, alive: true, hand: [], handCount: 0, equipment: {}, skills: [], vars: {}, marks: [], distanceVars: { attackRange: 1 } },
    ],
    cardMap: { jd: makeCard('jd', '借刀杀人', '锦囊牌'), wp0: makeCard('wp0', '诸葛连弩', '装备牌'), wp1: makeCard('wp1', '诸葛连弩', '装备牌') },
    pending: null,
    deadline: null,
    log: [],
  } as unknown as GameView;
}

const slotsFilter: TargetFilter = {
  min: 2, max: 2,
  slots: [
    { label: '持武器者', filter: (_view: GameView, t: number) => !!_view.players[t]?.equipment?.['武器'] },
    { label: '被杀者', filter: (view: GameView, t: number, ctx: { selected: number[] }) => {
      // B 必须在 A(=ctx.selected[0])的攻击范围内:简化为距离判断
      const aIdx = ctx.selected[0];
      if (aIdx === undefined) return false;
      const alive = view.players.filter(p => p.alive);
      const n = alive.length;
      const aliveA = alive.findIndex(p => p.name === view.players[aIdx]?.name);
      const aliveT = alive.findIndex(p => p.name === view.players[t]?.name);
      if (aliveA < 0 || aliveT < 0) return false;
      const seatDist = Math.min(Math.abs(aliveA - aliveT), n - Math.abs(aliveA - aliveT));
      return seatDist <= (view.players[aIdx]?.distanceVars?.attackRange ?? 1);
    } },
  ],
};

describe('TargetSelector:slots 多目标渲染', () => {
  beforeEach(() => {});

  it('slots 模式:首槽位只显示符合条件的玩家(持武器者)', () => {
    const view = makeView();
    const calls: Array<[string, number]> = [];
    render(
      <TargetSelector
        view={view}
        perspectiveIdx={0}
        selectedCardId="jd"
        perspectiveHand={[makeCard('jd', '借刀杀人', '锦囊牌')]}
        transformMode={null}
        targetFilter={slotsFilter}
        selectedTarget={null}
        selectedKillTarget={null}
        isTargetable={() => true}
        onTargetClick={() => {}}
        onSlotSelect={(name, idx) => calls.push([name, idx])}
        onTransformPlay={() => {}}
      />,
    );
    // 首槽位标题
    expect(screen.getByText(/选 持武器者/)).toBeTruthy();
    // P1 有武器可选,P2/P3 无武器不可选(disabled)
    const p1Btn = screen.getByText(/P1/).closest('button')!;
    const p2Btn = screen.getByText(/P2/).closest('button')!;
    expect(p1Btn.disabled).toBe(false);
    expect(p2Btn.disabled).toBe(true);
    // 未选 A 时,B 槽位不渲染
    expect(screen.queryByText(/选 被杀者/)).toBeNull();
  });

  it('slots 模式:选 A 后渲染 B 槽位,B 依赖 A 的攻击范围', () => {
    const view = makeView();
    render(
      <TargetSelector
        view={view}
        perspectiveIdx={0}
        selectedCardId="jd"
        perspectiveHand={[makeCard('jd', '借刀杀人', '锦囊牌')]}
        transformMode={null}
        targetFilter={slotsFilter}
        selectedTarget="P1"
        selectedKillTarget={null}
        isTargetable={() => true}
        onTargetClick={() => {}}
        onSlotSelect={() => {}}
        onTransformPlay={() => {}}
      />,
    );
    // 选 A=P1 后,B 槽位标题出现
    expect(screen.getByText(/选 被杀者/)).toBeTruthy();
    // P2 距离 P1 为 1(在范围),可选;P3 距离 P1 为 2(超出范围 1),不可选
    // A 槽位也渲染 P2(无武器 disabled),取 B 槽位的按钮(用 getAllBy 取最后一个匹配)
    const p2Btns = screen.getAllByText(/P2/).map(el => el.closest('button')!);
    const p3Btns = screen.getAllByText(/P3/).map(el => el.closest('button')!);
    // B 槽位的按钮是最后渲染的(A 槽位在前)
    const p2B = p2Btns[p2Btns.length - 1];
    const p3B = p3Btns[p3Btns.length - 1];
    expect(p2B.disabled).toBe(false);
    expect(p3B.disabled).toBe(true);
  });

  it('无 slots 单目标模式:渲染单个目标列表,点击调 onTargetClick', () => {
    const view = makeView();
    let clicked: string | null = null;
    render(
      <TargetSelector
        view={view}
        perspectiveIdx={0}
        selectedCardId="s1"
        perspectiveHand={[makeCard('s1', '杀')]}
        transformMode={null}
        targetFilter={{ min: 1, max: 1 }}
        selectedTarget={null}
        selectedKillTarget={null}
        isTargetable={() => true}
        onTargetClick={(name) => { clicked = name; }}
        onSlotSelect={() => {}}
        onTransformPlay={() => {}}
      />,
    );
    expect(screen.getByText('选择目标:')).toBeTruthy();
    fireEvent.click(screen.getByText(/P1/));
    expect(clicked).toBe('P1');
  });

  it('转化模式:点击目标调 onTransformPlay 而非 onTargetClick', () => {
    const view = makeView();
    let transformPlayed: string | null = null;
    let targetClicked = false;
    render(
      <TargetSelector
        view={view}
        perspectiveIdx={0}
        selectedCardId="c1"
        perspectiveHand={[makeCard('c1', '红牌')]}
        transformMode={{ wrapperName: '杀' }}
        targetFilter={{ min: 1, max: 1 }}
        selectedTarget={null}
        selectedKillTarget={null}
        isTargetable={() => true}
        onTargetClick={() => { targetClicked = true; }}
        onSlotSelect={() => {}}
        onTransformPlay={(name) => { transformPlayed = name; }}
      />,
    );
    fireEvent.click(screen.getByText(/P1/));
    expect(transformPlayed).toBe('P1');
    expect(targetClicked).toBe(false);
  });
});
