// 前端渲染测试:五谷丰登选牌面板(pickProcessingCard prompt)。
// 验证 AwaitingPrompt 对 pickProcessingCard 的渲染:处理区明牌作为可点按钮,
// 点击后 onAction 以 { cardId } 格式提交 respond。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView, Card } from '../../src/engine/types';
import type { QueuedEvent } from '../../src/client/hooks/useEventPlayback';

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
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    zones: { deckCount: 18, processing: ['pa', 'pb'], discardPileCount: 0 },
  } as unknown as GameView;
}

/** P2 视角:引擎发的 pending 只含未被选走的牌(pa 已从 processing 移除),
 *  但 view.cardMap 仍含全量牌,P2 玩家名=孙权。 */
function makeViewWithWuguPendingForP2(cards: Record<string, Card>): GameView {
  const ids = Object.keys(cards);
  // pending 只含仍在处理区的牌(排除已被选走的 pa)
  const available = ids.filter(id => id !== 'pa');
  return {
    viewer: 1,
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
    cardMap: cards,
    pending: {
      type: 'awaits',
      atom: {
        type: '请求回应',
        requestType: '五谷丰登/select',
        target: 1,
        prompt: {
          type: 'pickProcessingCard',
          title: '五谷丰登:选择 1 张牌',
          cards: available.map(id => ({
            cardId: id,
            cardName: cards[id].name,
            suit: cards[id].suit,
            rank: cards[id].rank,
          })),
        },
        timeout: 20,
      },
      prompt: {
        type: 'pickProcessingCard',
        title: '五谷丰登:选择 1 张牌',
        cards: available.map(id => ({
          cardId: id,
          cardName: cards[id].name,
          suit: cards[id].suit,
          rank: cards[id].rank,
        })),
      },
      target: 1,
      deadline: Date.now() + 20000,
      totalMs: 20000,
      startTime: Date.now(),
    },
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    // P2 视角:pa 已不在处理区(被选走),只剩 pb/pc
    zones: {
      deckCount: 18,
      processing: available,
      discardPileCount: 0,
    },
  } as unknown as GameView;
}

describe('五谷丰登选牌面板(pickProcessingCard)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('渲染处理区明牌为可点按钮(杀/桃)', async () => {
    const view = makeViewWithWuguPending();
    render(<GameViewComponent view={view} onAction={() => {}} />);

    // 等待技能 actions 加载完成(pickProcessingCard 渲染不依赖 registry,但 AwaitingPrompt 可能异步推导)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /杀/ })).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /桃/ })).toBeDefined();
  });

  it('点击某张牌按钮后,onAction 以 { cardId } 格式提交 respond', async () => {
    const view = makeViewWithWuguPending();
    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} />);

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

// ── 五谷丰登选牌展示增强:被选走的牌置暗禁用并标注选牌者 ──

describe('五谷丰登选牌展示增强(被选牌禁用渲染)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('被选走的牌渲染为禁用且不可点击,未选牌仍可点', async () => {
    // P2 视角:引擎发的 pending 只含 pb/pc(pa 已被 P1 选走从 processing 移除)
    // 但 view.cardMap 仍含全量牌,且 currentEvent 携带 pa 被选走的公开事件
    const pa = makeCard('pa', '杀', '♠', '7');
    const pb = makeCard('pb', '桃', '♥', '2');
    const pc = makeCard('pc', '闪', '♣', '8');
    const view = makeViewWithWuguPendingForP2({ pa, pb, pc });
    // 模拟 pa 被 P1 选走的公开事件
    const pickEvent: QueuedEvent = {
      seq: 10,
      event: {
        type: '移动牌',
        cardId: 'pa',
        from: { zone: '处理区' },
        to: { zone: '手牌', player: 0 },
      },
    };

    render(<GameViewComponent view={view} onAction={() => {}} currentEvent={pickEvent} />);

    // pa 应渲染为禁用按钮并标注选牌者
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /已被P1选走/ })).toBeDefined();
    });
    // pa 按钮应为 disabled
    const paBtn = screen.getByRole('button', { name: /杀/ });
    expect(paBtn.hasAttribute('disabled')).toBe(true);

    // pb/pc 仍可点
    const pbBtn = screen.getByRole('button', { name: /桃/ });
    expect(pbBtn.hasAttribute('disabled')).toBe(false);
    const pcBtn = screen.getByRole('button', { name: /闪/ });
    expect(pcBtn.hasAttribute('disabled')).toBe(false);
  });

  it('被选走的牌标注正确的选牌者名称', async () => {
    const pa = makeCard('pa', '杀', '♠', '7');
    const pb = makeCard('pb', '桃', '♥', '2');
    const view = makeViewWithWuguPendingForP2({ pa, pb });
    const pickEvent: QueuedEvent = {
      seq: 11,
      event: {
        type: '移动牌',
        cardId: 'pa',
        from: { zone: '处理区' },
        to: { zone: '手牌', player: 0 }, // player 0 = P1
      },
    };

    render(<GameViewComponent view={view} onAction={() => {}} currentEvent={pickEvent} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /已被P1选走/ })).toBeDefined();
    });
  });
});
