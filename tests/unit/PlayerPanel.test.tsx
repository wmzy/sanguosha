import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlayerPanel, type PlayerPanelData } from '../../src/components/PlayerPanel';
import type { SelfView, OtherPlayerView, CardInfo } from '../../engine/view/types';

function makeCardInfo(id: string, name: string, subtype: '武器' | '防具' | '马'): CardInfo {
  return {
    id, name, type: '装备牌', subtype, suit: '♠', rank: 'A', description: '',
  };
}

const emptyCardMap: Record<string, CardInfo> = {};

const selfView: PlayerPanelData = {
  kind: 'self',
  data: {
    characterId: '曹操',
    hand: [],
    equipment: { weapon: null, armor: null, mount: null },
    health: 4,
    maxHealth: 4,
    pendingTricks: [],
    tags: [],
    vars: {},
    alive: true,
  },
};

const otherView: PlayerPanelData = {
  kind: 'other',
  data: {
    characterId: '张飞',
    handCount: 0,
    equipment: { weapon: null, armor: null, mount: null },
    health: 4,
    maxHealth: 4,
    pendingTrickCount: 0,
    alive: true,
  },
};

function makeSelfViewWith(overrides: Partial<SelfView> = {}): PlayerPanelData {
  return { kind: 'self', data: { ...selfView.data, ...overrides } as SelfView };
}

function makeOtherViewWith(overrides: Partial<OtherPlayerView> = {}): PlayerPanelData {
  return { kind: 'other', data: { ...otherView.data, ...overrides } as OtherPlayerView };
}

describe('PlayerPanel', () => {
  it('显示角色名（从 data.characterId）', () => {
    render(
      <PlayerPanel
        playerName="P1"
        data={selfView}
        cardMap={emptyCardMap}
        isCurrentPlayer={false}
        isSelf={false}
      />,
    );
    expect(screen.getByText('曹操')).toBeInTheDocument();
  });

  it('显示体力', () => {
    render(
      <PlayerPanel
        playerName="P1"
        data={selfView}
        cardMap={emptyCardMap}
        isCurrentPlayer={false}
        isSelf={false}
      />,
    );
    expect(screen.getByText(/体力/)).toBeInTheDocument();
  });

  it('自己视角显示身份', () => {
    render(
      <PlayerPanel
        playerName="P1"
        data={selfView}
        cardMap={emptyCardMap}
        isCurrentPlayer={false}
        isSelf={true}
        role="主公"
      />,
    );
    expect(screen.getByText(/主公/)).toBeInTheDocument();
  });

  it('他人视角隐藏身份', () => {
    render(
      <PlayerPanel
        playerName="P1"
        data={otherView}
        cardMap={emptyCardMap}
        isCurrentPlayer={false}
        isSelf={false}
      />,
    );
    expect(screen.getByText(/\?\?\?/)).toBeInTheDocument();
  });

  it('当前玩家有高亮边框', () => {
    const { container } = render(
      <PlayerPanel
        playerName="P1"
        data={selfView}
        cardMap={emptyCardMap}
        isCurrentPlayer={true}
        isSelf={false}
      />,
    );
    const div = container.firstChild as HTMLElement;
    // 当前玩家使用 accent.red 实色边框
    expect(div.style.border).toContain('rgb');
  });

  it('死亡玩家有半透明效果', () => {
    const deadView = makeSelfViewWith({ alive: false });
    const { container } = render(
      <PlayerPanel
        playerName="P1"
        data={deadView}
        cardMap={emptyCardMap}
        isCurrentPlayer={false}
        isSelf={false}
      />,
    );
    const div = container.firstChild as HTMLElement;
    // 死亡玩家 opacity 设为 0.5
    expect(div.style.opacity).toBe('0.5');
  });

  it('self 视角：有武器时显示武器名', () => {
    const weaponCard = makeCardInfo('w1', '青龙偃月刀', '武器');
    const view = makeSelfViewWith({
      equipment: { weapon: weaponCard, armor: null, mount: null },
    });
    render(
      <PlayerPanel
        playerName="P1"
        data={view}
        cardMap={{ w1: weaponCard }}
        isCurrentPlayer={false}
        isSelf={true}
      />,
    );
    expect(screen.getByText(/青龙偃月刀/)).toBeInTheDocument();
  });

  it('self 视角：有防具时显示防具名', () => {
    const armorCard = makeCardInfo('a1', '八卦阵', '防具');
    const view = makeSelfViewWith({
      equipment: { weapon: null, armor: armorCard, mount: null },
    });
    render(
      <PlayerPanel
        playerName="P1"
        data={view}
        cardMap={{ a1: armorCard }}
        isCurrentPlayer={false}
        isSelf={true}
      />,
    );
    expect(screen.getByText(/八卦阵/)).toBeInTheDocument();
  });

  it('self 视角：有坐骑时显示坐骑名（无论武器是否存在）', () => {
    const weaponCard = makeCardInfo('w1', '青龙偃月刀', '武器');
    const mountCard = makeCardInfo('m1', '的卢', '马');
    const view = makeSelfViewWith({
      equipment: { weapon: weaponCard, armor: null, mount: mountCard },
    });
    render(
      <PlayerPanel
        playerName="P1"
        data={view}
        cardMap={{ w1: weaponCard, m1: mountCard }}
        isCurrentPlayer={false}
        isSelf={true}
      />,
    );
    expect(screen.getByText(/的卢/)).toBeInTheDocument();
  });

  it('self 视角：只有坐骑时仍正确显示', () => {
    const mountCard = makeCardInfo('m2', '绝影', '马');
    const view = makeSelfViewWith({
      equipment: { weapon: null, armor: null, mount: mountCard },
    });
    render(
      <PlayerPanel
        playerName="P1"
        data={view}
        cardMap={{ m2: mountCard }}
        isCurrentPlayer={false}
        isSelf={true}
      />,
    );
    expect(screen.getByText(/绝影/)).toBeInTheDocument();
  });

  it('other 视角：显示 characterId', () => {
    const view = makeOtherViewWith({ characterId: '关羽' });
    render(
      <PlayerPanel
        playerName="P2"
        data={view}
        cardMap={emptyCardMap}
        isCurrentPlayer={false}
        isSelf={false}
      />,
    );
    expect(screen.getByText('关羽')).toBeInTheDocument();
  });

  it('other 视角：装备名也能从 cardMap 解析', () => {
    const weaponCard = makeCardInfo('w2', '丈八蛇矛', '武器');
    const view = makeOtherViewWith({
      equipment: { weapon: weaponCard, armor: null, mount: null },
    });
    render(
      <PlayerPanel
        playerName="P2"
        data={view}
        cardMap={{ w2: weaponCard }}
        isCurrentPlayer={false}
        isSelf={false}
      />,
    );
    expect(screen.getByText(/丈八蛇矛/)).toBeInTheDocument();
  });
});
