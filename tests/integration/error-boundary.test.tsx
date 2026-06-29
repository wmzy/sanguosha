import { Component, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../src/client/components/ErrorBoundary';

interface BombProps {
  shouldThrow: boolean;
  throwMessage?: string;
}

class Bomb extends Component<BombProps> {
  override render(): ReactNode {
    if (this.props.shouldThrow) {
      throw new Error(this.props.throwMessage ?? 'boom');
    }
    return <div data-testid="bomb">bomb-ok</div>;
  }
}

describe('ErrorBoundary — 局部错误隔离', () => {
  let errorSpy: MockInstance;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('子级 ErrorBoundary 捕获错误时，根级 UI 仍正常渲染', () => {
    render(
      <ErrorBoundary context="root">
        <div data-testid="root-content">root-content</div>
        <ErrorBoundary context="child">
          <Bomb shouldThrow={true} throwMessage="inner-boom" />
        </ErrorBoundary>
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('root-content')).toBeInTheDocument();
    expect(screen.getByText(/child 出错了/)).toBeInTheDocument();
    expect(screen.getByText(/inner-boom/)).toBeInTheDocument();
  });

  it('未抛错时不渲染 fallback', () => {
    render(
      <ErrorBoundary context="root">
        <ErrorBoundary context="child">
          <Bomb shouldThrow={false} />
        </ErrorBoundary>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('bomb')).toBeInTheDocument();
    expect(screen.queryByText(/child 出错了/)).not.toBeInTheDocument();
  });
});

describe('ErrorBoundary — 重试按钮', () => {
  let errorSpy: MockInstance;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('点击"重试"清除 error state 并允许 children 重新挂载', () => {
    const { rerender } = render(
      <ErrorBoundary context="game-board">
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/game-board 出错了/)).toBeInTheDocument();

    rerender(
      <ErrorBoundary context="game-board">
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/game-board 出错了/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('error-boundary-retry'));
    expect(screen.getByTestId('bomb')).toBeInTheDocument();
  });

  it('重试时不触发整页 reload（window.location.reload 未被调用）', () => {
    const reloadSpy = vi.fn();
    const originalReload = window.location.reload;
    Object.defineProperty(window, 'reload', {
      value: reloadSpy,
      writable: true,
      configurable: true,
    });
    try {
      render(
        <ErrorBoundary context="game-board">
          <Bomb shouldThrow={true} />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByTestId('error-boundary-retry'));
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'reload', {
        value: originalReload,
        writable: true,
        configurable: true,
      });
    }
  });
});

describe('ErrorBoundary — context 日志', () => {
  let errorSpy: MockInstance;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('componentDidCatch 将 context 写入 logger', () => {
    render(
      <ErrorBoundary context="websocket">
        <Bomb shouldThrow={true} throwMessage="ws-boom" />
      </ErrorBoundary>,
    );

    const calls: string[] = errorSpy.mock.calls.flat().map((c: unknown) => String(c));
    const hasContextLog = calls.some((c) => c.includes('ErrorBoundary:websocket'));
    expect(hasContextLog).toBe(true);
  });

  it('未指定 context 时使用 root 作为日志分类', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} throwMessage="root-boom" />
      </ErrorBoundary>,
    );
    const calls: string[] = errorSpy.mock.calls.flat().map((c: unknown) => String(c));
    const hasRootLog = calls.some(
      (c) => c.includes('context: root') || c.includes('ErrorBoundary:'),
    );
    expect(hasRootLog).toBe(true);
  });
});

describe('ErrorBoundary — resetKey 自动重置', () => {
  let errorSpy: MockInstance;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('resetKey 变化时自动清除 error state', () => {
    const { rerender } = render(
      <ErrorBoundary context="game-board" resetKey="a">
        <Bomb shouldThrow={true} throwMessage="first" />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/game-board 出错了/)).toBeInTheDocument();

    rerender(
      <ErrorBoundary context="game-board" resetKey="b">
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('bomb')).toBeInTheDocument();
  });

  it('resetKey 不变时不会自动重置', () => {
    const { rerender } = render(
      <ErrorBoundary context="game-board" resetKey="same">
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/game-board 出错了/)).toBeInTheDocument();

    rerender(
      <ErrorBoundary context="game-board" resetKey="same">
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/game-board 出错了/)).toBeInTheDocument();
  });
});

describe('ErrorBoundary — 自定义 fallback 与 onReset 回调', () => {
  let errorSpy: MockInstance;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('fallback prop 覆盖默认错误 UI', () => {
    render(
      <ErrorBoundary
        context="game-board"
        fallback={<div data-testid="custom-fallback">CUSTOM_FALLBACK</div>}
      >
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.getByText('CUSTOM_FALLBACK')).toBeInTheDocument();
    expect(screen.queryByText(/game-board 出错了/)).not.toBeInTheDocument();
  });

  it('onReset 在重试时被调用', () => {
    const onResetSpy = vi.fn();
    render(
      <ErrorBoundary context="game-board" onReset={onResetSpy}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByTestId('error-boundary-retry'));
    expect(onResetSpy).toHaveBeenCalledTimes(1);
  });
});
