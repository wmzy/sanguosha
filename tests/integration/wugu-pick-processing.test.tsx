// 前端渲染测试:五谷丰登选牌面板(pickProcessingCard prompt)。
// 验证 AwaitingPrompt 对 pickProcessingCard 的渲染:处理区明牌作为可点按钮,
// 点击后 onAction 以 { cardId } 格式提交 respond。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView, Card } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A'): Card {
  return { id, name, suit, rank, type: '基本牌' };
}

function makeViewWithWuguPending(): GameView {
  const pa = makeCard('pa', '杀', '♠', '7');
  const pb = makeCard('pb', '桃', '♥', '2');
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: 'P1',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['五谷丰登', '无懈可击'],
        handCount: 0,
        hand: [],
        marks: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '孙权',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['五谷丰登', '无懈可击'],
        handCount: 1,
        marks: [],
      },
    ],
    cardMap: { pa, pb },
    pending: {
      type: 'awaits',
      atom: {
        type: '请求回应',
        requestType: '五谷丰登/select',
        target: 0,
        prompt: {
          type: 'pickProcessingCard',
          title: '五谷丰登:选择 1 张牌',
          cards: [
            { cardId: 'pa', cardName: '杀', suit: '♠', rank: '7' },
            { cardId: 'pb', cardName: '桃', suit: '♥', rank: '2' },
          ],
        },
        timeout: 20,
      },
      prompt: {
        type: 'pickProcessingCard',
        title: '五谷丰登:选择 1 张牌',
        cards: [
          { cardId: 'pa', cardName: '杀', suit: '♠', rank: '7' },
          { cardId: 'pb', cardName: '桃', suit: '♥', rank: '2' },
        ],
      },
      target: 0,
      deadline: Date.now() + 20000,
      totalMs: 20000,
      startTime: Date.now(),
    },
    turnDeadline: null,
    turnTotalMs: 0,
    log: [],
    zones: { deckCount: 18, processing: ['pa', 'pb'], discardPileCount: 0 },
  } as unknown as GameView;
}

describe('五谷丰登选牌面板(pickProcessingCard)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('渲染处理区明牌为可点按钮(杀/桃)', async () => {
    const view = makeViewWithWuguPending();
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    // 等待技能 actions 加载完成(pickProcessingCard 渲染不依赖 registry,但 AwaitingPrompt 可能异步推导)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /杀/ })).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /桃/ })).toBeDefined();
  });

  it('点击某张牌按钮后,onAction 以 { cardId } 格式提交 respond', async () => {
    const view = makeViewWithWuguPending();
    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} onDeleteRoom={() => {}} perspective={view.viewer} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /桃/ })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /桃/ }));

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
        skillId: '五谷丰登',
        actionType: 'respond',
        params: expect.objectContaining({ cardId: 'pb' }),
      }));
    });
  });
});
