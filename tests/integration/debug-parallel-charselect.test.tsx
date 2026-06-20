// 前端渲染测试:debug 模式并行选将。
//   主公(viewer)选完后,view.pending 为空,但 view.allCharSelectSlots 含其他玩家的选将 slot。
//   前端应:
//   1. 自动切换视角到第一个未选完的玩家,显示其选将界面(CharSelectOverlay)
//   2. 用户手动切换视角后,能看到对应玩家的候选人
//   3. 帮选后,视角自动跟到下一个未选玩家
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { GameViewComponent, type ActionMsg } from '../../src/client/components/GameView';
import { useDebugPerspective } from '../../src/client/hooks/useDebugPerspective';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView } from '../../engine/types';

/** 测试 wrapper:模拟 DebugLobby 的 DebugGameView(用 useDebugPerspective 驱动视角)。 */
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

function makeView(): GameView {
  // debug 模式:viewer=0(主公,已选刘备)。P1/P2 未选,有并行选将 slot。
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '准备',
    turn: { round: 1, phase: '准备', vars: {} },
    players: [
      {
        index: 0, name: 'player-0', character: '刘备',
        health: 4, maxHealth: 4, alive: true, equipment: {}, skills: ['仁德'],
        handCount: 0, marks: [], identity: '主公',
      },
      {
        index: 1, name: 'player-1', character: '',
        health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [],
        handCount: 0, marks: [],
      },
      {
        index: 2, name: 'player-2', character: '',
        health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [],
        handCount: 0, marks: [],
      },
    ],
    cardMap: {},
    pending: null, // viewer(主公)已选完,无自己的 pending
    allCharSelectSlots: [
      {
        type: 'awaits',
        atom: { type: '选将询问', target: 1, candidates: [{ name: '孙权', skills: ['制衡'] }, { name: '曹操', skills: ['护甲'] }] },
        prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: [] },
        target: 1, deadline: Date.now() + 60000, totalMs: 60000,
      },
      {
        type: 'awaits',
        atom: { type: '选将询问', target: 2, candidates: [{ name: '关羽', skills: ['武圣'] }, { name: '郭嘉', skills: ['遗计'] }] },
        prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: [] },
        target: 2, deadline: Date.now() + 60000, totalMs: 60000,
      },
    ],
    turnDeadline: null,
    log: [],
  };
}

describe('GameView:debug 并行选将切换视角', () => {
  beforeEach(() => {
    clearRegistry();
    // 关闭身份揭示遮罩(避免盖住选将界面)
    sessionStorage.setItem('sgs_identity_shown', '1');
  });

  it('viewer(主公)已选完时,自动切到第一个未选玩家(player-1)显示其选将界面', async () => {
    const view = makeView();
    render(<TestGameView view={view} onAction={() => {}} />);

    // 应自动切到 player-1 视角并显示选将界面(CharSelectOverlay 标题 "P1 选将中")
    await waitFor(() => {
      expect(screen.getByText(/P1 选将中/)).toBeDefined();
    });
    // 显示 player-1 的候选人(孙权/曹操)
    expect(screen.getByText('孙权')).toBeDefined();
    expect(screen.getByText('曹操')).toBeDefined();
  });

  it('手动切换视角到 player-2 后,显示 player-2 的候选人(关羽/郭嘉)', async () => {
    const view = makeView();
    render(<TestGameView view={view} onAction={() => {}} />);

    // 先等 player-1 选将界面出现
    await waitFor(() => {
      expect(screen.getByText(/P1 选将中/)).toBeDefined();
    });

    // 点视角切换按钮(CharSelectOverlay 里的 "视角: ..." 按钮)切到 player-2
    // 有两个"视角:"按钮(遮罩内 + 顶部 header),取遮罩内的(zIndex 10000 容器)
    const switchBtns = screen.getAllByRole('button', { name: /视角:/ });
    fireEvent.click(switchBtns[0]);
    await waitFor(() => {
      expect(screen.getByText(/P2 选将中/)).toBeDefined();
    });
    // player-2 的候选人
    expect(screen.getByText('关羽')).toBeDefined();
    expect(screen.getByText('郭嘉')).toBeDefined();
  });

  it('帮 player-1 选将后,onAction 以正确 ownerId 提交', async () => {
    const view = makeView();
    const onAction = vi.fn();
    render(<TestGameView view={view} onAction={onAction} />);

    await waitFor(() => {
      expect(screen.getByText(/P1 选将中/)).toBeDefined();
    });

    // 点候选人 孙权(CharSelectOverlay 里候选人卡是 div,点击文本选中高亮)
    fireEvent.click(screen.getByText('孙权'));
    // 再点"确认选择"按钮提交
    const confirmBtn = screen.getByRole('button', { name: /确认选择/ });
    fireEvent.click(confirmBtn);

    // 应以 ownerId=1(player-1) 提交选将 action
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
        skillId: '系统规则',
        actionType: '选将',
        ownerId: 1,
        params: { character: '孙权' },
      }));
    });
  });

  it('手动切到已选完的玩家后,显示等待遮罩(含切换视角按钮)', async () => {
    // viewer=0 已选,手动切到 player-0(主公,已选)→ 显示等待遮罩 + 切换按钮
    const view = makeView();
    render(<TestGameView view={view} onAction={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/P1 选将中/)).toBeDefined();
    });

    // 切到主公(需切两次:player-1 → player-2 → player-0)
    const switchBtn = () => screen.getAllByRole('button', { name: /视角:/ })[0];
    fireEvent.click(switchBtn()); // → player-2
    await waitFor(() => expect(screen.getByText(/P2 选将中/)).toBeDefined());
    fireEvent.click(switchBtn()); // → player-0(主公,已选)

    // player-0 已选完:显示等待遮罩,而非选将界面
    await waitFor(() => {
      expect(screen.getByText(/已选择武将.*等待其他玩家选将/)).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /切换视角/ })).toBeDefined();
  });
});
