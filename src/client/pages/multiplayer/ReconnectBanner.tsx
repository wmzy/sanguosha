// src/client/pages/multiplayer/ReconnectBanner.tsx
// 重连提示覆盖层(非阻塞:显示在内容之上,不阻止渲染)。
// reconnecting 分支显示进度 + 取消按钮;failed 分支提示检查网络 + 返回大厅。
import { btnStyle, colors } from '../../theme';
import type { ConnectionState } from '../../hooks/useMultiplayerRoom';
import { reconnectOverlay, reconnectFailedOverlay, reconnectSpinner } from './multiplayerStyles';

interface ReconnectBannerProps {
  connectionState: ConnectionState;
  /** 当前重连尝试次数 */
  reconnectAttempt: number;
  /** 取消重连 */
  onCancel: () => void;
  /** 放弃重连并返回大厅 */
  onLeave: () => void;
}

export function ReconnectBanner({ connectionState, reconnectAttempt, onCancel, onLeave }: ReconnectBannerProps) {
  if (connectionState === 'reconnecting') {
    return (
      <div className={reconnectOverlay}>
        <span className={reconnectSpinner} />
        <span>
          正在重连… (第 {reconnectAttempt} 次)
        </span>
        <button
          className={btnStyle}
          style={{
            '--btn-bg': colors.accent.darkRed,
            '--btn-padding': '4px 12px',
            '--btn-font-size': '12px',
          } as React.CSSProperties}
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    );
  }
  if (connectionState === 'failed') {
    return (
      <div className={reconnectFailedOverlay}>
        <span>重连失败,请检查网络</span>
        <button
          className={btnStyle}
          style={{
            '--btn-bg': colors.accent.darkRed,
            '--btn-padding': '4px 12px',
            '--btn-font-size': '12px',
          } as React.CSSProperties}
          onClick={onLeave}
        >
          返回大厅
        </button>
      </div>
    );
  }
  return null;
}
