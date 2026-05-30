interface ReplayBoardProps {
  onExit: () => void;
}

export function ReplayBoard({ onExit }: ReplayBoardProps) {
  return (
    <div style={{ padding: 20, backgroundColor: '#1a1a2e', minHeight: '100vh', color: '#eee' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>重播模式</h1>
        <button onClick={onExit} style={exitBtnStyle}>退出重播</button>
      </div>

      <div style={{
        textAlign: 'center',
        padding: 60,
        backgroundColor: '#2c3e50',
        borderRadius: 12,
      }}>
        <div style={{ fontSize: 24, marginBottom: 16, color: '#f39c12' }}>
          重播功能暂未适配 V2 引擎
        </div>
        <div style={{ fontSize: 14, color: '#95a5a6' }}>
          新的重播系统将基于 V2 引擎的事件日志重建，敬请期待。
        </div>
      </div>
    </div>
  );
}

const exitBtnStyle: React.CSSProperties = {
  padding: '8px 20px',
  backgroundColor: '#7f8c8d',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};
