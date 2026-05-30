// src/components/ActionPanel.tsx
import { colors, styles } from '../theme';

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
        style={styles.btn(canPlay ? colors.accent.red : colors.text.dim, {
          padding: '10px 28px',
          cursor: canPlay ? 'pointer' : 'not-allowed',
        })}
      >
        出牌
      </button>
      <button
        onClick={onEndTurn}
        disabled={!canEndTurn}
        style={styles.btn(canEndTurn ? colors.accent.blue : colors.text.dim, {
          padding: '10px 28px',
          cursor: canEndTurn ? 'pointer' : 'not-allowed',
        })}
      >
        结束回合
      </button>
    </div>
  );
}
