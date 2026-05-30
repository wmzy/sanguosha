import { colors } from '../theme';

interface TimerProps {
  seconds: number;
  paused: boolean;
  onToggle: () => void;
}

export function Timer({ seconds, paused, onToggle }: TimerProps) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const isLow = seconds <= 10;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        fontSize: 20,
        fontWeight: 'bold',
        fontFamily: 'monospace',
        color: isLow ? colors.accent.red : paused ? colors.accent.amber : colors.accent.green,
        minWidth: 60,
        textAlign: 'center',
      }}
      >
        {minutes}:{secs.toString().padStart(2, '0')}
      </div>
      <button
        onClick={onToggle}
        style={{
          padding: '2px 8px',
          backgroundColor: paused ? colors.accent.green : colors.accent.amber,
          color: colors.white,
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        {paused ? '继续' : '暂停'}
      </button>
    </div>
  );
}
