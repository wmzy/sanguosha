import { useState, useEffect, useRef, useCallback } from 'react';

interface ReplayControlsProps {
  currentStep: number;
  totalSteps: number;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (step: number) => void;
  players: string[];
  selectedPlayer: string;
  onSelectPlayer: (name: string) => void;
}

export function ReplayControls({
  currentStep,
  totalSteps,
  onPrev,
  onNext,
  onGoTo,
  players,
  selectedPlayer,
  onSelectPlayer,
}: ReplayControlsProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPlaying = useCallback(() => {
    setPlaying(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        onNext();
      }, 1000 / speed);
    } else {
      stopPlaying();
    }
    return stopPlaying;
  }, [playing, speed, onNext, stopPlaying]);

  useEffect(() => {
    if (currentStep >= totalSteps - 1) {
      stopPlaying();
    }
  }, [currentStep, totalSteps, stopPlaying]);

  const speeds = [0.5, 1, 2, 4];

  return (
    <div style={{
      backgroundColor: '#1a1a2e',
      borderRadius: 8,
      padding: 16,
      marginBottom: 16,
    }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={onPrev} disabled={currentStep <= 0} style={btnStyle}>
          上一步
        </button>
        <button onClick={() => setPlaying(!playing)} style={btnStyle}>
          {playing ? '暂停' : '播放'}
        </button>
        <button onClick={onNext} disabled={currentStep >= totalSteps - 1} style={btnStyle}>
          下一步
        </button>

        <input
          type="range"
          min={0}
          max={totalSteps - 1}
          value={currentStep}
          onChange={e => onGoTo(parseInt(e.target.value))}
          style={{ flex: 1 }}
        />

        <span style={{ color: '#bdc3c7', fontSize: 13, minWidth: 80 }}>
          {currentStep + 1}/{totalSteps}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: '#95a5a6', fontSize: 13 }}>速度:</span>
        {speeds.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            style={{
              ...btnStyle,
              backgroundColor: speed === s ? '#e74c3c' : '#34495e',
            }}
          >
            {s}x
          </button>
        ))}

        <span style={{ color: '#95a5a6', fontSize: 13, marginLeft: 16 }}>视角:</span>
        <select
          value={selectedPlayer}
          onChange={e => onSelectPlayer(e.target.value)}
          style={{
            backgroundColor: '#34495e',
            color: '#ecf0f1',
            border: 'none',
            borderRadius: 4,
            padding: '4px 8px',
          }}
        >
          {players.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '6px 16px',
  backgroundColor: '#34495e',
  color: '#ecf0f1',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};
