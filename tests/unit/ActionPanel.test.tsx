import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ActionPanel } from '../../src/components/ActionPanel';

describe('ActionPanel', () => {
  it('显示出牌和结束回合按钮', () => {
    render(<ActionPanel 能出牌={false} 能结束回合={false} 出牌={() => {}} 结束回合={() => {}} />);
    expect(screen.getByText('出牌')).toBeInTheDocument();
    expect(screen.getByText('结束回合')).toBeInTheDocument();
  });

  it('不能出牌时按钮禁用', () => {
    render(<ActionPanel 能出牌={false} 能结束回合={false} 出牌={() => {}} 结束回合={() => {}} />);
    expect(screen.getByText('出牌')).toBeDisabled();
  });

  it('能出牌时按钮可用', () => {
    render(<ActionPanel 能出牌={true} 能结束回合={false} 出牌={() => {}} 结束回合={() => {}} />);
    expect(screen.getByText('出牌')).not.toBeDisabled();
  });

  it('点击出牌调用回调', () => {
    const onPlay = vi.fn();
    render(<ActionPanel 能出牌={true} 能结束回合={false} 出牌={onPlay} 结束回合={() => {}} />);
    fireEvent.click(screen.getByText('出牌'));
    expect(onPlay).toHaveBeenCalled();
  });

  it('点击结束回合调用回调', () => {
    const onEndTurn = vi.fn();
    render(<ActionPanel 能出牌={false} 能结束回合={true} 出牌={() => {}} 结束回合={onEndTurn} />);
    fireEvent.click(screen.getByText('结束回合'));
    expect(onEndTurn).toHaveBeenCalled();
  });
});
