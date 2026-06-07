import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReplayControls } from '../../src/client/components/ReplayControls';

const defaultProps = {
  currentStep: 2,
  totalSteps: 10,
  speed: 1,
  isPlaying: false,
  perspectives: ['曹操', '刘备', '孙权'],
  selectedPerspective: '曹操',
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onGoTo: vi.fn(),
  onTogglePlay: vi.fn(),
  onSpeedChange: vi.fn(),
  onPerspectiveChange: vi.fn(),
  onClose: vi.fn(),
};

describe('ReplayControls', () => {
  it('点击下一步触发 onNext', () => {
    const onNext = vi.fn();
    render(<ReplayControls {...defaultProps} onNext={onNext} />);
    fireEvent.click(screen.getByLabelText('下一步'));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('点击上一步触发 onPrev', () => {
    const onPrev = vi.fn();
    render(<ReplayControls {...defaultProps} onPrev={onPrev} />);
    fireEvent.click(screen.getByLabelText('上一步'));
    expect(onPrev).toHaveBeenCalledOnce();
  });

  it('点击播放/暂停切换 isPlaying', () => {
    const onTogglePlay = vi.fn();
    render(<ReplayControls {...defaultProps} onTogglePlay={onTogglePlay} isPlaying={false} />);
    fireEvent.click(screen.getByLabelText('播放'));
    expect(onTogglePlay).toHaveBeenCalledOnce();
  });

  it('进度条输入触发 onGoTo', () => {
    const onGoTo = vi.fn();
    render(<ReplayControls {...defaultProps} onGoTo={onGoTo} />);
    fireEvent.change(screen.getByLabelText('进度条'), { target: { value: '5' } });
    expect(onGoTo).toHaveBeenCalledWith(5);
  });

  it('视角下拉切换触发 onPerspectiveChange', () => {
    const onPerspectiveChange = vi.fn();
    render(<ReplayControls {...defaultProps} onPerspectiveChange={onPerspectiveChange} />);
    fireEvent.change(screen.getByLabelText('切换视角'), { target: { value: '刘备' } });
    expect(onPerspectiveChange).toHaveBeenCalledWith('刘备');
  });

  it('上一步在 step=0 时 disabled', () => {
    render(<ReplayControls {...defaultProps} currentStep={0} />);
    expect(screen.getByLabelText('上一步')).toBeDisabled();
  });

  it('下一步在 step=totalSteps-1 时 disabled', () => {
    render(<ReplayControls {...defaultProps} currentStep={9} totalSteps={10} />);
    expect(screen.getByLabelText('下一步')).toBeDisabled();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<ReplayControls {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
