// LEGACY TEST: references deleted v2 modules - skipped
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
// import { ActionPanel } from '../../src/client/components/ActionPanel';  // LEGACY: removed (v2 module deleted)

describe.skip('ActionPanel', () => {
  it('显示出牌和结束回合按钮', () => {
    render(<ActionPanel canPlay={false} canEndTurn={false} onPlayCard={() => {}} onEndTurn={() => {}} />);
    expect(screen.getByText('出牌')).toBeInTheDocument();
    expect(screen.getByText('结束回合')).toBeInTheDocument();
  });

  it('不能出牌时按钮禁用', () => {
    render(<ActionPanel canPlay={false} canEndTurn={false} onPlayCard={() => {}} onEndTurn={() => {}} />);
    expect(screen.getByText('出牌')).toBeDisabled();
  });

  it('能出牌时按钮可用', () => {
    render(<ActionPanel canPlay={true} canEndTurn={false} onPlayCard={() => {}} onEndTurn={() => {}} />);
    expect(screen.getByText('出牌')).not.toBeDisabled();
  });

  it('点击出牌调用回调', () => {
    const onPlay = vi.fn();
    render(<ActionPanel canPlay={true} canEndTurn={false} onPlayCard={onPlay} onEndTurn={() => {}} />);
    fireEvent.click(screen.getByText('出牌'));
    expect(onPlay).toHaveBeenCalled();
  });

  it('点击结束回合调用回调', () => {
    const onEndTurn = vi.fn();
    render(<ActionPanel canPlay={false} canEndTurn={true} onPlayCard={() => {}} onEndTurn={onEndTurn} />);
    fireEvent.click(screen.getByText('结束回合'));
    expect(onEndTurn).toHaveBeenCalled();
  });
});
