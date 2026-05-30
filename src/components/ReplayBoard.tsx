import { colors, styles } from '../theme';

interface ReplayBoardProps {
  onExit: () => void;
}

export function ReplayBoard({ onExit }: ReplayBoardProps) {
  return (
    <div style={styles.page()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>重播模式</h1>
        <button onClick={onExit} style={styles.btn(colors.text.dim)}>退出重播</button>
      </div>

      <div style={{
        textAlign: 'center',
        padding: 60,
        backgroundColor: colors.bg.panel,
        borderRadius: 12,
      }}>
        <div style={{ fontSize: 24, marginBottom: 16, color: colors.accent.amber }}>
          重播功能暂未适配 V2 引擎
        </div>
        <div style={{ fontSize: 14, color: colors.text.muted }}>
          新的重播系统将基于 V2 引擎的事件日志重建，敬请期待。
        </div>
      </div>
    </div>
  );
}
