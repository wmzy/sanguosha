import { Component, type ErrorInfo, type ReactNode } from 'react';
import { css } from '@linaria/core';
import { colors, btnStyle } from '../theme';
import { createLogger } from '../utils/logger';

const rootLog = createLogger('ErrorBoundary');

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * 错误日志分类标识（如 'game-board' / 'websocket' / 'root'）。
   * 出现错误时，context 会写入 logger 输出，便于按区域定位问题。
   */
  context?: string;
  /**
   * 局部重置键：当 resetKey 变化时，ErrorBoundary 自动清除 error state，
   * 重新渲染子组件。用于"切房间 / 重新开始"等场景。
   */
  resetKey?: string | number;
  /**
   * 局部重置回调：fallback 中的"重试"按钮点击时调用。
   * 父组件可以配合 resetKey 一起使用，触发完整重置。
   */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const rootBox = css`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: ${colors.bg.page};
  color: ${colors.text.primary};
  padding: 24px;
`;

const panelBox = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: ${colors.bg.panel};
  color: ${colors.text.primary};
  padding: 24px;
  border-radius: 12px;
  margin: 16px;
  min-height: 200px;
`;

const titleText = css`
  color: ${colors.accent.red};
  margin-bottom: 16px;
`;

const subtitle = css`
  color: ${colors.text.muted};
  margin-bottom: 16px;
`;

const detailBlock = css`
  max-width: 600px;
  margin-bottom: 24px;
`;

const detailSummary = css`
  cursor: pointer;
  color: ${colors.accent.amber};
`;

const errorPre = css`
  margin-top: 12px;
  padding: 12px;
  background-color: ${colors.bg.nav};
  border-radius: 8px;
  font-size: 12px;
  color: ${colors.accent.red};
  overflow: auto;
  max-height: 300px;
`;

const buttonRow = css`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
`;

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const ctx = this.props.context ?? 'root';
    const log = createLogger(`ErrorBoundary:${ctx}`);
    log.error('React Error Boundary caught', {
      error: String(error),
      componentStack: errorInfo.componentStack,
    });
    // 同时写一份到 root log，保证未配置 context 时也有输出
    rootLog.error('React Error Boundary caught', { context: ctx, error: String(error) });
  }

  /**
   * 局部重置：仅清除当前 boundary 的 error state，
   * 不触发整页刷新。重置后子组件会以 fresh state 重新挂载。
   */
  resetError = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const ctx = this.props.context;
      const isRoot = !ctx || ctx === 'root';
      const containerClass = isRoot ? rootBox : panelBox;

      return (
        <div className={containerClass}>
          <h1 className={titleText}>{isRoot ? '出错了' : `${ctx} 出错了`}</h1>
          <p className={subtitle}>
            {isRoot ? '游戏遇到了一个意外错误' : `该区域（${ctx}）遇到错误，可点击重试局部恢复`}
          </p>
          <details className={detailBlock}>
            <summary className={detailSummary}>查看错误详情</summary>
            <pre className={errorPre}>
              {this.state.error?.message}
              {'\n'}
              {this.state.error?.stack}
            </pre>
          </details>
          <div className={buttonRow}>
            <button
              onClick={this.resetError}
              className={btnStyle}
              style={
                {
                  '--btn-bg': colors.accent.green,
                  '--btn-padding': '10px 24px',
                  '--btn-font-size': '14px',
                } as React.CSSProperties
              }
              data-testid="error-boundary-retry"
            >
              {isRoot ? '重试' : '局部重试'}
            </button>
            {isRoot && (
              <button
                onClick={() => window.location.reload()}
                className={btnStyle}
                style={
                  {
                    '--btn-bg': colors.accent.blue,
                    '--btn-padding': '12px 32px',
                    '--btn-font-size': '16px',
                  } as React.CSSProperties
                }
              >
                重新加载
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
