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
        color: isLow ? '#e74c3c' : paused ? '#f39c12' : '#2ecc71',
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
          backgroundColor: paused ? '#2ecc71' : '#f39c12',
          color: 'white',
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
