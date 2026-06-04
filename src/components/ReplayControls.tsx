import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { css, cx } from '@linaria/core';
import { colors } from '../theme';

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

const root = css`
  background-color: ${colors.bg.page};
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
`;

const topRow = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
`;

const bottomRow = css`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const btnBase = css`
  padding: 6px 16px;
  background-color: ${colors.bg.input};
  color: ${colors.text.input};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
`;

const btnActive = css`
  background-color: ${colors.accent.red};
`;

const slider = css`
  flex: 1;
`;

const stepLabel = css`
  color: ${colors.text.secondary};
  font-size: 13px;
  min-width: 80px;
`;

const speedLabel = css`
  color: ${colors.text.muted};
  font-size: 13px;
`;

const perspectiveLabel = css`
  color: ${colors.text.muted};
  font-size: 13px;
  margin-left: 16px;
`;

const selectStyle = css`
  background-color: ${colors.bg.input};
  color: ${colors.text.input};
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
`;

export const ReplayControls = memo(function ReplayControls({
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
    <div className={root}>
      <div className={topRow}>
        <button onClick={onPrev} disabled={currentStep <= 0} className={btnBase}>
          上一步
        </button>
        <button onClick={() => setPlaying(!playing)} className={btnBase}>
          {playing ? '暂停' : '播放'}
        </button>
        <button onClick={onNext} disabled={currentStep >= totalSteps - 1} className={btnBase}>
          下一步
        </button>

        <input
          type="range"
          min={0}
          max={totalSteps - 1}
          value={currentStep}
          onChange={e => onGoTo(parseInt(e.target.value))}
          className={slider}
        />

        <span className={stepLabel}>{currentStep + 1}/{totalSteps}</span>
      </div>

      <div className={bottomRow}>
        <span className={speedLabel}>速度:</span>
        {speeds.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={cx(btnBase, speed === s && btnActive)}
          >
            {s}x
          </button>
        ))}

        <span className={perspectiveLabel}>视角:</span>
        <select
          value={selectedPlayer}
          onChange={e => onSelectPlayer(e.target.value)}
          className={selectStyle}
        >
          {players.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
    </div>
  );
});
