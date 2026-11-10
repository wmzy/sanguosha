// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import type { GameView, Card } from '../../src/engine/types';
import type { ArenaManifest } from '../../src/arena/types';
import { ArenaTable } from '../../src/client/components/arena/ArenaTable';
import { TargetPointerSvg, getSeatBorderPoint, getArrowPolygon } from '../../src/client/components/arena/TargetPointerSvg';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';

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
        name: '孙权',
        character: '孙权',
        health: 4,
        maxHealth: 5,
        alive: true,
        equipment: {},
        skills: ['制衡'],
        handCount: 3,
        hand: [],
        marks: [],
        tags: [],
        identity: '主公',
      },
      {
        index: 1,
        name: '界赵云',
        character: '界赵云',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['界龙胆'],
        handCount: 3,
        hand: [],
        marks: [],
        tags: [],
        identity: '内奸',
      },
      {
        index: 2,
        name: '界貂蝉',
        character: '界貂蝉',
        health: 0,
        maxHealth: 3,
        alive: false,
        equipment: {},
        skills: ['离间'],
        handCount: 0,
        hand: [],
        marks: [],
        tags: [],
        identity: '反贼',
      },
    ],
    cardMap: {},
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

function makeTestManifest(): ArenaManifest {
  return {
    id: 'test-match-cutoff',
    name: '死者切除与横向箭头验证',
    status: 'playing',
    players: [
      { id: 'p0', name: '孙权', mode: 'api' },
      { id: 'p1', name: '界赵云', mode: 'api' },
      { id: 'p2', name: '界貂蝉', mode: 'api' },
    ],
    startedAt: Date.now(),
    roomId: 'TEST_ROOM',
  };
}

describe('问题 1: 武将死亡以后切除与状态隔离验证', () => {
  it('阵亡角色即使存在于旧 settlementStack 中，绝不作为指向源或目标，也不显示金色出牌高亮', () => {
    // 模拟第2轮：死者貂蝉（index: 2）在第1轮贴了乐不思蜀，此时孙权在判定阶段结算
    const view = makeTestView({
      phase: '判定' as any,
      settlementStack: [
        {
          skillId: '乐不思蜀',
          from: 2, // 死者
          params: {
            cardId: 'c_le',
            targets: [0],
            resolvedTargets: [0],
          },
          cards: [],
          cancelled: false,
        },
      ],
    });

    const { container } = render(
      <ArenaTable view={view} manifest={makeTestManifest()} assetsReady={true} />
    );

    // 死者座次绝对不能带有 is-targeting-source 高亮金边
    const seatDead = container.querySelector('[data-testid="arena-player-2"]');
    expect(seatDead?.className).toContain('is-dead');
    expect(seatDead?.className).not.toContain('is-targeting-source');
    expect(seatDead?.className).not.toContain('is-target-locked');

    // 判定阶段不应渲染指向死者的战术连线
    expect(container.querySelector('[data-testid="arena-targeting-svg"]')).toBeNull();
  });

  it('Headless 客户端中，当角色阵亡后 needsAction 恒为 false 且 getAvailableActions 为空', () => {
    const hgc = new HeadlessGameClient('http://localhost:3930', {});
    (hgc as any)._seatIndex = 2;
    (hgc as any)._view = makeTestView({
      pending: {
        type: 'responseWindow' as any,
        target: 2,
        isBlocking: true,
        atom: { type: '请求回应', requestType: '桃/求桃', target: 2, prompt: { type: 'useCard' } } as any,
        prompt: { type: 'useCard' } as any,
      },
    });

    // 座次 2 为阵亡玩家
    expect(hgc.needsAction()).toBe(false);
    expect(hgc.getAvailableActions()).toEqual([]);
  });
});

describe('问题 2: 横向及全向战术指向箭头与准星渲染验证', () => {
  it('横向左右指向（如 Seat 2 到 Seat 5）在目标座次边框处精确渲染显式箭头与战术准星', () => {
    const sourcePos: [number, number] = [14, 48]; // 左侧座次
    const targetPos: [number, number] = [86, 48]; // 右侧座次

    // 验证座次边框交点算法
    const border = getSeatBorderPoint(targetPos, sourcePos);
    expect(border[0]).toBe(75); // 86 - 11 = 75（右侧座次左边框）
    expect(border[1]).toBe(48);

    const arrow = getArrowPolygon(sourcePos, targetPos);
    expect(arrow.tip).toEqual([75, 48]);

    const { container } = render(
      <TargetPointerSvg sourcePos={sourcePos} targetPositions={[targetPos]} variant="default" />
    );

    const svg = container.querySelector('[data-testid="arena-targeting-svg"]');
    expect(svg).toBeTruthy();

    // 验证显式箭头多边形存在且包含计算出的目标边框顶点
    const arrowhead = container.querySelector('[data-testid="arena-target-arrowhead-0"]');
    expect(arrowhead).toBeTruthy();
    expect(arrowhead?.getAttribute('points')).toContain('75.00,48.00');

    // 验证战术准星存在且定位在目标边框交点
    const reticle = container.querySelector('[data-testid="arena-target-reticle-0"]');
    expect(reticle).toBeTruthy();
    expect(reticle?.getAttribute('cx')).toBe('75');
    expect(reticle?.getAttribute('cy')).toBe('48');
  });

  it('铁索连环模式下箭头与准星采用 cold-blue 样式类与冷银蓝配色', () => {
    const sourcePos: [number, number] = [50, 82];
    const targetPos: [number, number] = [29, 17];

    const { container } = render(
      <TargetPointerSvg sourcePos={sourcePos} targetPositions={[targetPos]} variant="chain" />
    );

    const arrowhead = container.querySelector('[data-testid="arena-target-arrowhead-0"]');
    expect(arrowhead?.getAttribute('fill')).toBe('#38bdf8');
    expect(arrowhead?.getAttribute('class')).toContain('is-chain');

    const reticle = container.querySelector('[data-testid="arena-target-reticle-0"]');
    expect(reticle?.getAttribute('stroke')).toBe('#38bdf8');
    expect(reticle?.getAttribute('class')).toContain('is-chain');
  });
});
