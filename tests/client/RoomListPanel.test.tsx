// @vitest-environment jsdom
// tests/client/RoomListPanel.test.tsx
// RoomListPanel 组件测试:房主 id 展示、「我的」tab 过滤。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomListPanel } from '../../src/client/components/RoomListPanel';
import type { RoomInfo } from '../../src/server/protocol';

const noop = () => {};

const makeRoom = (overrides: Partial<RoomInfo> = {}): RoomInfo => ({
  id: 'ROOM01',
  name: '测试房',
  playerCount: 1,
  maxPlayers: 4,
  status: '等待中',
  hostId: 'host-1',
  ...overrides,
});

describe('RoomListPanel — 房主 id 展示', () => {
  it('房间卡片中展示房主 id', () => {
    const rooms = [makeRoom({ hostId: '孔明' })];
    render(
      <RoomListPanel rooms={rooms} onRefresh={noop} onJoin={noop} />,
    );
    expect(screen.getByText(/房主.*孔明/)).toBeInTheDocument();
  });

  it('hostId 为 null 时不展示房主行', () => {
    const rooms = [makeRoom({ hostId: null })];
    render(
      <RoomListPanel rooms={rooms} onRefresh={noop} onJoin={noop} />,
    );
    expect(screen.queryByText(/房主/)).not.toBeInTheDocument();
  });
});

describe('RoomListPanel — 「我的」tab 过滤', () => {
  it('传入 currentPlayerId 时展示 tab 栏(全部 + 我的)', () => {
    const rooms = [makeRoom({ hostId: '赵子龙' })];
    render(
      <RoomListPanel rooms={rooms} onRefresh={noop} onJoin={noop} currentPlayerId="赵子龙" />,
    );
    expect(screen.getByText(/全部/)).toBeInTheDocument();
    expect(screen.getByText(/我的/)).toBeInTheDocument();
  });

  it('未传 currentPlayerId 时不展示 tab 栏', () => {
    const rooms = [makeRoom({ hostId: '赵子龙' })];
    render(
      <RoomListPanel rooms={rooms} onRefresh={noop} onJoin={noop} />,
    );
    expect(screen.queryByText(/全部/)).not.toBeInTheDocument();
    expect(screen.queryByText(/我的/)).not.toBeInTheDocument();
  });

  it('「我的」tab 只显示房主 === 当前玩家的房间', () => {
    const rooms = [
      makeRoom({ id: 'R1', name: '我的房', hostId: '赵子龙' }),
      makeRoom({ id: 'R2', name: '别人的房', hostId: '孔明' }),
      makeRoom({ id: 'R3', name: '无主房', hostId: null }),
    ];
    render(
      <RoomListPanel rooms={rooms} onRefresh={noop} onJoin={noop} currentPlayerId="赵子龙" />,
    );
    // 默认全部 tab:三间房都可见
    expect(screen.getByText('我的房')).toBeInTheDocument();
    expect(screen.getByText('别人的房')).toBeInTheDocument();
    expect(screen.getByText('无主房')).toBeInTheDocument();

    // 切到「我的」tab
    fireEvent.click(screen.getByText(/我的.*1/));
    expect(screen.getByText('我的房')).toBeInTheDocument();
    expect(screen.queryByText('别人的房')).not.toBeInTheDocument();
    expect(screen.queryByText('无主房')).not.toBeInTheDocument();
  });

  it('「我的」tab 无匹配房间时显示空提示', () => {
    const rooms = [makeRoom({ hostId: '孔明' })];
    render(
      <RoomListPanel rooms={rooms} onRefresh={noop} onJoin={noop} currentPlayerId="赵子龙" />,
    );
    fireEvent.click(screen.getByText(/我的.*0/));
    expect(screen.getByText('你还没有创建的房间')).toBeInTheDocument();
  });

  it('房主匹配当前玩家时显示「我建的」标记', () => {
    const rooms = [makeRoom({ hostId: '赵子龙' })];
    render(
      <RoomListPanel rooms={rooms} onRefresh={noop} onJoin={noop} currentPlayerId="赵子龙" />,
    );
    expect(screen.getByText('我建的')).toBeInTheDocument();
  });
});

describe('RoomListPanel — 已在房间时显示「进入」按钮', () => {
  it('当前玩家已在房间时显示「进入」按钮，不显示「加入」和「旁观」', () => {
    const rooms = [makeRoom({ playerIds: ['赵子龙', '孔明'] })];
    render(
      <RoomListPanel
        rooms={rooms}
        onRefresh={noop}
        onJoin={noop}
        onSpectate={noop}
        currentPlayerId="赵子龙"
      />,
    );
    expect(screen.getByText('进入')).toBeInTheDocument();
    expect(screen.queryByText('加入')).not.toBeInTheDocument();
    expect(screen.queryByText('旁观')).not.toBeInTheDocument();
  });

  it('当前玩家不在房间时显示「加入」和「旁观」按钮，不显示「进入」', () => {
    const rooms = [makeRoom({ playerIds: ['孔明'] })];
    render(
      <RoomListPanel
        rooms={rooms}
        onRefresh={noop}
        onJoin={noop}
        onSpectate={noop}
        currentPlayerId="赵子龙"
      />,
    );
    expect(screen.queryByText('进入')).not.toBeInTheDocument();
    expect(screen.getByText('加入')).toBeInTheDocument();
    expect(screen.getByText('旁观')).toBeInTheDocument();
  });

  it('点击「进入」按钮调用 onJoin 并传入正确 roomId', () => {
    const onJoin = vi.fn();
    const rooms = [makeRoom({ id: 'ENTER1', playerIds: ['赵子龙'] })];
    render(
      <RoomListPanel
        rooms={rooms}
        onRefresh={noop}
        onJoin={onJoin}
        currentPlayerId="赵子龙"
      />,
    );
    fireEvent.click(screen.getByText('进入'));
    expect(onJoin).toHaveBeenCalledWith('ENTER1');
  });

  it('房间未携带 playerIds 时回退为「加入」按钮(兼容旧数据)', () => {
    const rooms = [makeRoom()];
    render(
      <RoomListPanel
        rooms={rooms}
        onRefresh={noop}
        onJoin={noop}
        onSpectate={noop}
        currentPlayerId="赵子龙"
      />,
    );
    expect(screen.queryByText('进入')).not.toBeInTheDocument();
    expect(screen.getByText('加入')).toBeInTheDocument();
  });
});
