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
import type { GameView, Card } from '../../src/engine/types';

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
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
    ...overrides,
  };
}

describe('GameView:装备牌出牌(回归 selectedUseAction 查找)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('选中武器牌后渲染"出牌"按钮(以 装备通用 注册的 use action 被找到)', async () => {
    const view = makeView();
    render(<GameViewComponent view={view} onAction={() => {}} />);

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
    render(<GameViewComponent view={view} onAction={onAction} />);

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
    render(<GameViewComponent view={view} onAction={onAction} />);

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
    render(<GameViewComponent view={view} onAction={() => {}} />);

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
    render(<GameViewComponent view={view} onAction={() => {}} />);

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

// ─── 丈八蛇矛多卡转化:显示控制 + selectedUseAction 查找(回归两个 bug) ───
//   Bug1:进入转化模式后所有手牌都显示为"杀"(应只有选中的两张)。
//         根因 isTransformMatch = cardFilter(card),丈八蛇矛 cardFilter 恒真 → 全量 match。
//         修复:多卡模式下 isTransformMatch 仅对已选中牌为 true。
//   Bug2:选够 2 张后无法指定目标。根因 selectedUseAction 在多卡模式下因
//         selectedCardId 为 null 直接 return undefined → selectedActive=false
//         → showTargetSelector=false。修复:多卡模式不依赖单卡选择。
describe('GameView:丈八蛇矛多卡转化(显示 + 目标选择回归)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  function makeZhangbaView(): GameView {
    const zb = { id: 'zb', name: '丈八蛇矛', suit: '♠', rank: 'Q', type: '装备牌', subtype: '武器', range: 3 } as Card;
    const c1 = { id: 'c1', name: '闪', suit: '♠', rank: '2', type: '基本牌' } as Card;
    const c2 = { id: 'c2', name: '桃', suit: '♣', rank: '3', type: '基本牌' } as Card;
    const c3 = { id: 'c3', name: '无中生有', suit: '♥', rank: 'A', type: '锦囊牌' } as Card;
    return {
      viewer: 0,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      players: [
        {
          index: 0, name: 'P1', character: '张飞', health: 4, maxHealth: 4, alive: true,
          equipment: { 武器: 'zb' }, skills: ['丈八蛇矛', '杀'],
          handCount: 3, hand: [c1, c2, c3], marks: [],
        },
        {
          index: 1, name: 'P2', character: '曹操', health: 4, maxHealth: 4, alive: true,
          equipment: {}, skills: [], handCount: 0, marks: [],
        },
      ],
      cardMap: { zb, c1, c2, c3 },
      pending: null,
      deadline: null,
      deadlineTotalMs: 0,
      log: [],
      settlementStack: [],
    };
  }

  it('Bug1:转化模式下仅选中的牌显示为"杀",未选中的保持原名', async () => {
    const view = makeZhangbaView();
    render(<GameViewComponent view={view} onAction={() => {}} />);

    // 点装备区丈八蛇矛按钮 → 多卡转化模式
    const zhangbaBtn = await screen.findByRole('button', { name: '丈八蛇矛' });
    fireEvent.click(zhangbaBtn);
    await waitFor(() => expect(screen.getByText(/转化模式/)).toBeDefined());

    // 选中 c1、c2
    fireEvent.click(document.querySelector('[data-card-id="c1"]')!);
    fireEvent.click(document.querySelector('[data-card-id="c2"]')!);

    // 选中的牌显示为"杀"并标注原卡名
    expect((document.querySelector('[data-card-id="c1"]') as HTMLElement).textContent).toContain('原: 闪');
    expect((document.querySelector('[data-card-id="c2"]') as HTMLElement).textContent).toContain('原: 桃');
    // 未选中的 c3 保持原名、无转化标注(修复前会显示"原: 无中生有")
    const c3 = document.querySelector('[data-card-id="c3"]') as HTMLElement;
    expect(c3.textContent).toContain('无中生有');
    expect(c3.textContent).not.toContain('原:');
  });

  it('Bug2:选够 2 张后渲染"使用杀"按钮(可指定目标)', async () => {
    const view = makeZhangbaView();
    render(<GameViewComponent view={view} onAction={() => {}} />);

    const zhangbaBtn = await screen.findByRole('button', { name: '丈八蛇矛' });
    fireEvent.click(zhangbaBtn);

    fireEvent.click(document.querySelector('[data-card-id="c1"]')!);
    fireEvent.click(document.querySelector('[data-card-id="c2"]')!);

    // 修复前 selectedActive=false → 按钮不渲染;修复后出现"使用杀"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /使用杀/ })).toBeDefined();
    });
  });

  it('选目标提交:preceding=丈八蛇矛.transform + 主 action=杀.use', async () => {
    const view = makeZhangbaView();
    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} />);

    const zhangbaBtn = await screen.findByRole('button', { name: '丈八蛇矛' });
    fireEvent.click(zhangbaBtn);

    fireEvent.click(document.querySelector('[data-card-id="c1"]')!);
    fireEvent.click(document.querySelector('[data-card-id="c2"]')!);

    // 目标选择面板(showTargetSelector 修复后显示)中点 P2 → onTransformPlay 直接提交
    const p2Target = await screen.findByRole('button', { name: /P2 \(曹操\)/ });
    fireEvent.click(p2Target);

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
        skillId: '杀', actionType: 'use',
        params: expect.objectContaining({ cardId: 'c1#c2#丈八蛇矛', targets: [1] }),
        preceding: [{ skillId: '丈八蛇矛', actionType: 'transform', params: { cardIds: ['c1', 'c2'] } }],
      }));
    });
  });
});
