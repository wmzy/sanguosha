// src/components/ActionPanel.tsx

interface ActionPanelProps {
  canPlay: boolean;
  canEndTurn: boolean;
  onPlayCard: () => void;
  onEndTurn: () => void;
}

export function ActionPanel({ canPlay, canEndTurn, onPlayCard, onEndTurn }: ActionPanelProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
      <button
        onClick={onPlayCard}
        disabled={!canPlay}
        style={{
          padding: '10px 28px',
          backgroundColor: canPlay ? '#e74c3c' : '#7f8c8d',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: canPlay ? 'pointer' : 'not-allowed',
          fontSize: 14,
          fontWeight: 'bold',
        }}
      >
        出牌
      </button>
      <button
        onClick={onEndTurn}
        disabled={!canEndTurn}
        style={{
          padding: '10px 28px',
          backgroundColor: canEndTurn ? '#3498db' : '#7f8c8d',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: canEndTurn ? 'pointer' : 'not-allowed',
          fontSize: 14,
          fontWeight: 'bold',
        }}
      >
        结束回合
      </button>
    </div>
  );
}
