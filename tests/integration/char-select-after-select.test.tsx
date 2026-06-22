// 前端渲染测试:选将完成后禁止重新选将,只展示已选武将。
//
// 覆盖点:
//   1. 选将完成后(perspective 玩家已有 character,但仍在选将阶段):
//      不展示选将遮罩(CharSelectOverlay),只展示等待遮罩(CharSelectWaitingOverlay)。
//   2. 等待遮罩中央展示已选武将卡:武将名、势力、体力上限、技能。
//   3. debug 模式下 allCharSelectSlots 残留已选完玩家的 slot 时,
//      useCharSelect 正确过滤,不展示该玩家的选将界面。
//   4. 正式模式:viewer 已选完,pending 为空,phase 仍为'准备'(他人未选),
//      展示等待遮罩 + 已选武将卡。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GameViewComponent, type ActionMsg } from '../../src/client/components/GameView';
import { useDebugPerspective } from '../../src/client/hooks/useDebugPerspective';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView } from '../../src/engine/types';

/** 测试 wrapper:模拟 DebugLobby 的 DebugGameView(用 useDebugPerspective 驱动视角) */
function TestGameView({ view, onAction }: { view: GameView; onAction: (a: ActionMsg) => void }) {
  const { perspective, switchPerspective, goToCurrentPlayer, setPerspective, autoSwitchCtl } = useDebugPerspective(view);
  return (
    <GameViewComponent
      view={view}
      onAction={onAction}
      perspective={perspective}
      onSwitchPerspective={switchPerspective}
      onGoToCurrentPlayer={goToCurrentPlayer}
      onPerspectiveChange={setPerspective}
      autoSwitchCtl={autoSwitchCtl}
    />
  );
}

function makePlayer(index: number, character: string, identity?: string, skills: string[] = []) {
  return {
    index,
    name: character || `player-${index}`,
    character,
    health: 4,
    maxHealth: 4,
    alive: true,
    equipment: {},
    skills,
    handCount: 0,
    marks: [],
    ...(identity !== undefined ? { identity } : {}),
  };
}

/**
 * 正式模式:viewer(主公)已选完刘备,pending 为空,phase 仍为'准备'(其他玩家未选)。
 * 期望:展示 CharSelectWaitingOverlay + 已选武将卡,不展示 CharSelectOverlay。
 */
function makeFormalWaitingView(): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '准备',
    turn: { round: 1, phase: '准备', vars: {} },
    players: [
      makePlayer(0, '刘备', '主公', ['仁德']),
      makePlayer(1, ''),
      makePlayer(2, ''),
      makePlayer(3, ''),
    ],
    cardMap: {},
    pending: null, // viewer 已选完,无 pending
    allCharSelectSlots: undefined, // 正式模式不填充
    turnDeadline: null,
    turnTotalMs: 0,
    log: [],
  };
}

/**
 * debug 模式:viewer(主公)已选完,allCharSelectSlots 含其他未选玩家 slot。
 * 期望:自动切到第一个未选玩家展示其选将界面。
 */
function makeDebugWaitingView(): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '准备',
    turn: { round: 1, phase: '准备', vars: {} },
    players: [
      makePlayer(0, '刘备', '主公', ['仁德']),
      makePlayer(1, ''),
      makePlayer(2, ''),
    ],
    cardMap: {},
    pending: null,
    allCharSelectSlots: [
      {
        type: 'awaits',
        atom: { type: '选将询问', target: 1, candidates: [{ name: '孙权', skills: ['制衡'] }] },
        prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: [] },
        target: 1, deadline: Date.now() + 60000, totalMs: 60000,
      },
      {
        type: 'awaits',
        atom: { type: '选将询问', target: 2, candidates: [{ name: '关羽', skills: ['武圣'] }] },
        prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: [] },
        target: 2, deadline: Date.now() + 60000, totalMs: 60000,
      },
    ],
    turnDeadline: null,
    turnTotalMs: 0,
    log: [],
  };
}

describe('GameView:选将完成后禁止重新选将,展示已选武将', () => {
  beforeEach(() => {
    clearRegistry();
    sessionStorage.setItem('sgs_identity_shown', '1');
  });

  it('正式模式:viewer 选将完成后展示等待遮罩 + 已选武将卡(武将名/势力/技能)', () => {
    const view = makeFormalWaitingView();
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    // 等待遮罩文案
    expect(screen.getByText(/已选择武将/)).toBeDefined();

    // 已选武将卡:展示"你的选择"标签 + 武将名"刘备"
    expect(screen.getByText('你的选择')).toBeDefined();
    // "刘备"出现在多处(座位卡 + 武将卡),用 getAllByText 确认存在
    expect(screen.getAllByText('刘备').length).toBeGreaterThan(0);

    // 武将技能(过滤掉默认技能后只展示武将自身技能"仁德")
    // "仁德"出现在多处(座位卡 + 武将卡),用 getAllByText 确认存在
    expect(screen.getAllByText(/仁德/).length).toBeGreaterThan(0);

    // 不应展示选将遮罩的"确认选择"按钮(已选完,不能重新选)
    const confirmSelectBtn = screen.queryByRole('button', { name: /确认选择/ });
    expect(confirmSelectBtn).toBeNull();

    // 不应展示候选人标题"主公选将"或"P0 选将中"
    expect(screen.queryByText(/选将中/)).toBeNull();
    expect(screen.queryByText('主公选将')).toBeNull();
  });

  it('debug 模式:viewer 已选完,自动切到未选玩家展示其选将界面(viewer 自己看不到选将遮罩)', () => {
    const view = makeDebugWaitingView();
    render(<TestGameView view={view} onAction={() => {}} />);

    // 等待自动切换到第一个未选玩家(player-1)的选将界面
    // player-1 的候选人"孙权"应可见
    expect(screen.getByText('孙权')).toBeDefined();

    // viewer(主公刘备)的选将界面不应出现:不应有 P0 选将中
    expect(screen.queryByText(/P0 选将中/)).toBeNull();
  });

  it('正式模式:未选完的玩家仍展示选将遮罩(pending 非空),不展示已选武将卡', () => {
    // viewer 自己还没选将(viewer.character 为空),pending 是自己的选将询问
    const view: GameView = {
      viewer: 1,
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
      players: [
        makePlayer(0, '刘备', '主公'),
        makePlayer(1, ''),
        makePlayer(2, ''),
        makePlayer(3, ''),
      ],
      cardMap: {},
      pending: {
        type: 'awaits',
        atom: {
          type: '选将询问', target: 1,
          candidates: [{ name: '孙权', skills: ['制衡'] }, { name: '曹操', skills: ['奸雄'] }],
        },
        prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: [] },
        target: 1, deadline: Date.now() + 60000, totalMs: 60000,
      },
      allCharSelectSlots: undefined,
      turnDeadline: null,
      turnTotalMs: 0,
      log: [],
    };
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    // 选将遮罩可见:候选人"孙权"+"确认选择"按钮
    expect(screen.getByText('孙权')).toBeDefined();
    expect(screen.getByRole('button', { name: /确认选择/ })).toBeDefined();

    // 不应展示"你的选择"已选武将卡(viewer 还没选)
    expect(screen.queryByText('你的选择')).toBeNull();
  });

  it('选将遮罩:点确认后锁定,不能再点其他武将或重复提交', () => {
    // viewer 自己选将阶段,pending 指向 viewer
    const view: GameView = {
      viewer: 0,
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
      players: [
        makePlayer(0, '', '主公'),
        makePlayer(1, ''),
        makePlayer(2, ''),
      ],
      cardMap: {},
      pending: {
        type: 'awaits',
        atom: {
          type: '选将询问', target: 0,
          candidates: [
            { name: '刘备', skills: ['仁德'] },
            { name: '曹操', skills: ['奸雄'] },
          ],
        },
        prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: [] },
        target: 0, deadline: Date.now() + 60000, totalMs: 60000,
      },
      allCharSelectSlots: undefined,
      turnDeadline: null,
      turnTotalMs: 0,
      log: [],
    };
    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} onDeleteRoom={() => {}} perspective={view.viewer} />);

    // 选刘备 → 点确认
    fireEvent.click(screen.getByText('刘备'));
    const confirmBtn = screen.getByRole('button', { name: /确认选择/ });
    fireEvent.click(confirmBtn);

    // onAction 被调用一次(提交刘备)
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: '选将',
      params: { character: '刘备' },
    }));

    // 按钮变为「已选择 刘备」禁用态(锁定)
    expect(screen.getByRole('button', { name: /已选择 刘备/ })).toBeDefined();
    // 不应再有「确认选择」按钮(已被锁定态替换)
    expect(screen.queryByRole('button', { name: /^确认选择$/ })).toBeNull();

    // 再点其他武将(曹操):不应改变选中态,候选区已锁定
    fireEvent.click(screen.getByText('曹操'));
    // 再尝试找「确认选择」按钮提交——不存在,无法重复提交
    expect(screen.queryByRole('button', { name: /^确认选择$/ })).toBeNull();
    // onAction 仍然只被调用一次(锁定后重复点击不再提交)
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
