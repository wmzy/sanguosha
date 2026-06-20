// 前端渲染测试:装备牌(诸葛连弩/赤兔等)在出牌阶段选中后能正常出牌。
//
// 回归根因:GameView 此前用 card.name(具体装备名,如 '诸葛连弩')在 registry 里
// 反查 use action,但装备的 use action 是以 skillId '装备通用' 注册的,查不到 →
// selectedUseAction 为 undefined → 不渲染"出牌"按钮,handlePlayCard 早退,装备点不出。
//
// 修复(filter-based):use action 的适用范围由技能 defineAction('use') 时声明的
// prompt.cardFilter 表达(装备通用声明 filter=c=>c.type==='装备牌')。前端遍历当前
// 玩家的 use action 跑 filter 匹配选中卡,而非用 card.name→skillId 反查。这消除了
// playCardSkillId 这类桥接函数及它带来的整类漂移 bug。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import { findUseActionForCard } from '../../src/client/utils/gameViewHelpers';
import type { GameView, Card } from '../../engine/types';

function makeEquipCard(id: string, name: string, subtype: string): Card {
  return { id, name, suit: '♠', rank: 'A', type: '装备牌', subtype } as Card;
}

function makeView(overrides: Partial<GameView> = {}): GameView {
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
        skills: ['装备通用'],
        handCount: 1,
        hand: [makeEquipCard('wp1', '诸葛连弩', '武器')],
        marks: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
    ],
    cardMap: { wp1: makeEquipCard('wp1', '诸葛连弩', '武器') },
    pending: null,
    turnDeadline: null,
    log: [],
    ...overrides,
  };
}

describe('GameView:装备牌出牌(回归 selectedUseAction 查找)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('选中武器牌后渲染"出牌"按钮(以 装备通用 注册的 use action 被找到)', async () => {
    const view = makeView();
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    // 等 '装备通用' 的 use action 通过 dynamic import 注册到 registry
    const weaponCard = await screen.findByText('诸葛连弩');
    fireEvent.click(weaponCard);

    // 选中装备牌后应出现"出牌"按钮(修复前 selectedUseAction 为 undefined → 不渲染)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^出牌/ })).toBeDefined();
    });
  });

  it('点击"出牌"按钮 → onAction 以 skillId="装备通用" 提交', async () => {
    const view = makeView();
    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} onDeleteRoom={() => {}} perspective={view.viewer} />);

    const weaponCard = await screen.findByText('诸葛连弩');
    fireEvent.click(weaponCard);

    const playBtn = await screen.findByRole('button', { name: /^出牌/ });
    fireEvent.click(playBtn);

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
        skillId: '装备通用',
        actionType: 'use',
        params: expect.objectContaining({ cardId: 'wp1' }),
      }));
    });
  });

  it('进攻马(赤兔)同样能出牌 — 装备通用覆盖所有装备子类型', async () => {
    const horse = makeEquipCard('h1', '赤兔', '进攻马');
    const view = makeView({
      players: [
        { ...makeView().players[0], hand: [horse], handCount: 1 },
        makeView().players[1],
      ],
      cardMap: { h1: horse },
    });
    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} onDeleteRoom={() => {}} perspective={view.viewer} />);

    const horseCard = await screen.findByText('赤兔');
    fireEvent.click(horseCard);

    const playBtn = await screen.findByRole('button', { name: /^出牌/ });
    fireEvent.click(playBtn);

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
        skillId: '装备通用',
        actionType: 'use',
        params: expect.objectContaining({ cardId: 'h1' }),
      }));
    });
  });
});

// ─── filter-based 查找的纯函数单测 ───
// 验证"适用范围来自 cardFilter 声明,而非 card.name 拼写":即便构造一个 card.name
// 与任何 skillId 都不匹配的牌,只要 cardFilter 通过,仍能被对应 use action 命中。
import { getActionsForPlayer, registerSkillActions } from '../../src/client/skillActionRegistry';

describe('findUseActionForCard:filter-based 匹配(声明即真相)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('装备牌被 装备通用 的 cardFilter 匹配,而非靠 card.name 反查', async () => {
    // 构造一张 card.name 与 skillId '装备通用' 毫无拼写关系的装备牌
    const weirdEquip: Card = { id: 'weird', name: '某种从没见过的武器', suit: '♠', rank: 'A', type: '装备牌', subtype: '武器' } as Card;
    await registerSkillActions(0, ['装备通用', '杀']);
    const actions = getActionsForPlayer(0);
    const matched = findUseActionForCard(actions, weirdEquip);
    expect(matched?.skillId).toBe('装备通用');
  });

  it('基本牌(杀)被对应牌名技能的 cardFilter 匹配', async () => {
    const slash: Card = { id: 's1', name: '杀', suit: '♠', rank: '7', type: '基本牌' } as Card;
    await registerSkillActions(0, ['杀', '装备通用']);
    const actions = getActionsForPlayer(0);
    const matched = findUseActionForCard(actions, slash);
    expect(matched?.skillId).toBe('杀');
  });

  it('没有匹配的 use action 时返回 undefined(如只有装备通用时出杀)', async () => {
    const slash: Card = { id: 's1', name: '杀', suit: '♠', rank: '7', type: '基本牌' } as Card;
    await registerSkillActions(0, ['装备通用']); // 只有装备 use action
    const actions = getActionsForPlayer(0);
    expect(findUseActionForCard(actions, slash)).toBeUndefined();
  });
});

// ─── activeWhen 声明时机:非出牌阶段/非自己回合时,use action 不激活 ───
// 验证"声明时机"原则真的生效:装备通用的 use action 在非出牌阶段(如弃牌阶段)或
// 非当前视角回合时,不被激活 → 选中装备牌也不渲染"出牌"按钮。这取代了过去
// GameView 里 isMyTurn && view.phase==='出牌' 的硬编码分支。
describe('isActiveAction:声明时机生效(非出牌阶段/非自己回合不出牌)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('弃牌阶段:选中装备牌不渲染"出牌"按钮(use action 未激活)', async () => {
    const base = makeView();
    const view: GameView = { ...base, phase: '弃牌', turn: { ...base.turn, phase: '弃牌' } };
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    // 用 data-card-id 精确定位手牌区卡牌(避免匹配到动画浮动元素)
    await waitFor(() => {
      const card = document.querySelector('[data-card-id="wp1"]') as HTMLElement;
      expect(card).toBeTruthy();
      fireEvent.click(card);
    });

    // 弃牌阶段下 use action 未激活,不应出现出牌按钮
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^出牌/ })).toBeNull();
    });
  });

  it('非自己回合:选中装备牌不渲染"出牌"按钮', async () => {
    const base = makeView();
    const view: GameView = { ...base, currentPlayerIndex: 1 };
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    await waitFor(() => {
      const card = document.querySelector('[data-card-id="wp1"]') as HTMLElement;
      expect(card).toBeTruthy();
      fireEvent.click(card);
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^出牌/ })).toBeNull();
    });
  });
});
