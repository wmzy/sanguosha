import { Component, type ErrorInfo, type ReactNode } from 'react';
import { colors, styles } from '../theme';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('React Error Boundary caught:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.bg.page,
            color: colors.text.primary,
            padding: 24,
          }}
        >
          <h1 style={{ color: colors.accent.red, marginBottom: 16 }}>出错了</h1>
          <p style={{ color: colors.text.muted, marginBottom: 16 }}>
            游戏遇到了一个意外错误
          </p>
          <details style={{ maxWidth: 600, marginBottom: 24 }}>
            <summary style={{ cursor: 'pointer', color: colors.accent.amber }}>
              查看错误详情
            </summary>
            <pre style={{
              marginTop: 12,
              padding: 12,
              backgroundColor: colors.bg.nav,
              borderRadius: 8,
              fontSize: 12,
              color: colors.accent.red,
              overflow: 'auto',
              maxHeight: 300,
            }}
            >
              {this.state.error?.message}
              {'\n'}
              {this.state.error?.stack}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            style={styles.btn(colors.accent.blue, { padding: '12px 32px', fontSize: 16 })}
          >
            重新加载
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
