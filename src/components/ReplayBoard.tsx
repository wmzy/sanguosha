import { css } from '@linaria/core';
import { colors, styles } from '../theme';

interface ReplayBoardProps {
  onExit: () => void;
}

const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`;

const headerTitle = css`
  margin: 0;
`;

const placeholderBox = css`
  text-align: center;
  padding: 60px;
  background-color: ${colors.bg.panel};
  border-radius: 12px;
`;

const placeholderTitle = css`
  font-size: 24px;
  margin-bottom: 16px;
  color: ${colors.accent.amber};
`;

const placeholderSubtitle = css`
  font-size: 14px;
  color: ${colors.text.muted};
`;

export function ReplayBoard({ onExit }: ReplayBoardProps) {
  return (
    <div style={styles.page()}>
      <div className={headerRow}>
        <h1 className={headerTitle}>重播模式</h1>
        <button onClick={onExit} style={styles.btn(colors.text.dim)}>退出重播</button>
      </div>

      <div className={placeholderBox}>
        <div className={placeholderTitle}>重播功能暂未适配 V2 引擎</div>
        <div className={placeholderSubtitle}>
          新的重播系统将基于 V2 引擎的事件日志重建，敬请期待。
        </div>
      </div>
    </div>
  );
}
