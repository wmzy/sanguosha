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
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    zones: { deckCount: 18, processing: ['pa', 'pb'], discardPileCount: 0 },
  } as unknown as GameView;
}

/** 构造 P2 视角的五谷丰登 view。
 *  cards: cardMap 全量牌; processingIds: 当前处理区(已排除被选牌);
 *  pendingIds: pending.cards 中列出的候选(=processingIds);
 *  handCounts: [P1手牌数, P2手牌数],用于 diff 推导选牌者。
 *  P2 玩家名=孙权。 */
function makeViewWithWuguPendingForP2(
  cards: Record<string, Card>,
  processingIds: string[],
  handCounts: [number, number],
): GameView {
  const available = processingIds.slice();
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
        handCount: handCounts[0],
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
        handCount: handCounts[1],
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
    // P2 视角:模拟五谷丰登选牌流程的状态变化。
    // hook 通过对 view 快照的 diff 推导被选牌(不依赖延时事件回放)。
    const pa = makeCard('pa', '杀', '♠', '7');
    const pb = makeCard('pb', '桃', '♥', '2');
    const pc = makeCard('pc', '闪', '♣', '8');
    const cards = { pa, pb, pc };

    // 步骤1:初始状态——三张牌都在处理区,各玩家手牌为0(建立基线快照)
    const initial = makeViewWithWuguPendingForP2(cards, ['pa', 'pb', 'pc'], [0, 0]);
    const { rerender } = render(<GameViewComponent view={initial} onAction={() => {}} />);

    // 步骤2:pa 被 P1 选走——pa 从 processing 消失,P1 handCount +1,pending 只剩 pb/pc
    const afterPick = makeViewWithWuguPendingForP2(cards, ['pb', 'pc'], [1, 0]);
    rerender(<GameViewComponent view={afterPick} onAction={() => {}} />);

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
    const cards = { pa, pb };

    // 基线:pa/pb 都在处理区,手牌为0
    const initial = makeViewWithWuguPendingForP2(cards, ['pa', 'pb'], [0, 0]);
    const { rerender } = render(<GameViewComponent view={initial} onAction={() => {}} />);

    // pa 被 P1 选走:processing=['pb'],P1 handCount=1
    const afterPick = makeViewWithWuguPendingForP2(cards, ['pb'], [1, 0]);
    rerender(<GameViewComponent view={afterPick} onAction={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /已被P1选走/ })).toBeDefined();
    });
  });

  it('多张牌被不同玩家选走时全部标注(不只有第一张)', async () => {
    // 这是原始 bug 的核心场景:旧实现依赖单一 currentEvent,只能捕获第一张被选牌,
    // 后续被选牌直接从 pending.cards/processing 消失,没有事件捕获就没了。
    // 新方案通过 view diff 累积所有被选牌。
    const pa = makeCard('pa', '杀', '♠', '7');
    const pb = makeCard('pb', '桃', '♥', '2');
    const pc = makeCard('pc', '闪', '♣', '8');
    const cards: Record<string, Card> = { pa, pb, pc };

    // P3 视角,3 玩家:P1=刘备, P2=孙权, P3=曹操(viewer=2)
    // 手工构造 view(现有 helper 只支持 2 玩家)
    const makeView3P = (processingIds: string[], handCounts: number[], target: number): GameView => ({
      viewer: 2,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      players: [
        { index: 0, name: 'P1', character: '刘备', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: ['五谷丰登'], handCount: handCounts[0], hand: [], marks: [] },
        { index: 1, name: 'P2', character: '孙权', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: ['五谷丰登'], handCount: handCounts[1], hand: [], marks: [] },
        { index: 2, name: 'P3', character: '曹操', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: ['五谷丰登'], handCount: handCounts[2], hand: [], marks: [] },
      ],
      cardMap: cards,
      pending: {
        type: 'awaits',
        atom: { type: '请求回应', requestType: '五谷丰登/select', target, prompt: { type: 'pickProcessingCard', title: '五谷丰登:选择 1 张牌', cards: processingIds.map(id => ({ cardId: id, cardName: cards[id].name, suit: cards[id].suit, rank: cards[id].rank })) }, timeout: 20 },
        prompt: { type: 'pickProcessingCard', title: '五谷丰登:选择 1 张牌', cards: processingIds.map(id => ({ cardId: id, cardName: cards[id].name, suit: cards[id].suit, rank: cards[id].rank })) },
        target,
        deadline: Date.now() + 20000,
        totalMs: 20000,
        startTime: Date.now(),
      },
      deadline: null,
      deadlineTotalMs: 0,
      log: [],
      zones: { deckCount: 15, processing: processingIds, discardPileCount: 0 },
    } as unknown as GameView);

    // 基线:三张牌都在处理区,手牌均为0,pending 指向 P1
    const initial = makeView3P(['pa', 'pb', 'pc'], [0, 0, 0], 0);
    const { rerender } = render(<GameViewComponent view={initial} onAction={() => {}} />);

    // P1 选 pa:processing=['pb','pc'],P1 handCount=1,pending 仍指向 P1(P1 视角看不到这个 P3 视角)
    const afterP1 = makeView3P(['pb', 'pc'], [1, 0, 0], 0);
    rerender(<GameViewComponent view={afterP1} onAction={() => {}} />);

    // P2 选 pb:processing=['pc'],P2 handCount=1,pending 指向 P3
    const afterP2 = makeView3P(['pc'], [1, 1, 0], 2);
    rerender(<GameViewComponent view={afterP2} onAction={() => {}} />);

    // pa 和 pb 都应被标注为已被选走(不只第一张)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /已被P1选走/ })).toBeDefined();
      expect(screen.getByRole('button', { name: /已被P2选走/ })).toBeDefined();
    });

    // pc 仍可点
    const pcBtn = screen.getByRole('button', { name: /闪/ });
    expect(pcBtn.hasAttribute('disabled')).toBe(false);
  });
});
