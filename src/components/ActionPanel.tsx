// src/components/ActionPanel.tsx

interface ActionPanelProps {
  能出牌: boolean;
  能结束回合: boolean;
  出牌: () => void;
  结束回合: () => void;
}

export function ActionPanel({ 能出牌, 能结束回合, 出牌, 结束回合 }: ActionPanelProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
      <button
        onClick={出牌}
        disabled={!能出牌}
        style={{
          padding: '10px 28px',
          backgroundColor: 能出牌 ? '#e74c3c' : '#7f8c8d',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: 能出牌 ? 'pointer' : 'not-allowed',
          fontSize: 14,
          fontWeight: 'bold',
        }}
      >
        出牌
      </button>
      <button
        onClick={结束回合}
        disabled={!能结束回合}
        style={{
          padding: '10px 28px',
          backgroundColor: 能结束回合 ? '#3498db' : '#7f8c8d',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: 能结束回合 ? 'pointer' : 'not-allowed',
          fontSize: 14,
          fontWeight: 'bold',
        }}
      >
        结束回合
      </button>
    </div>
  );
}
