// src/client/components/ReplayControls.tsx
// 回放控制条:步进/播放暂停/进度/速度/视角切换/退出。
// 纯展示组件,所有状态由 useReplay 驱动。

import { css } from '@linaria/core';
import { colors } from '../theme';
import type { ReplaySpeed } from '../hooks/useReplay';

export interface ReplayControlsProps {
  step: number;
  total: number;
  seat: number;
  seats: number[];
  playing: boolean;
  speed: ReplaySpeed;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (step: number) => void;
  onTogglePlay: () => void;
  onSetSpeed: (speed: ReplaySpeed) => void;
  onSetSeat: (seat: number) => void;
  onExit: () => void;
}

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 4];

const bar = css`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 16px;
  background-color: ${colors.bg.nav};
  border-bottom: 1px solid #334;
  color: ${colors.text.primary};
  font-size: 14px;
`;

const label = css`
  font-weight: bold;
  color: ${colors.accent.gold};
  white-space: nowrap;
`;

const btn = css`
  padding: 6px 14px;
  background-color: ${colors.bg.panel};
  color: ${colors.white};
  border: 1px solid #445;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  &:hover {
    background-color: ${colors.accent.blue};
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const playBtn = css`
  ${btn};
  background-color: ${colors.accent.green};
  &:hover {
    background-color: ${colors.accent.greenDark};
  }
`;

const progress = css`
  flex: 1;
  min-width: 150px;
  cursor: pointer;
  accent-color: ${colors.accent.gold};
`;

const speedGroup = css`
  display: flex;
  gap: 2px;
`;

const speedBtn = css`
  padding: 4px 8px;
  background-color: ${colors.bg.panel};
  color: ${colors.text.secondary};
  border: 1px solid #445;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  &:hover {
    color: ${colors.text.primary};
  }
`;

const speedBtnActive = css`
  ${speedBtn};
  background-color: ${colors.accent.blue};
  color: ${colors.white};
`;

const seatSelect = css`
  padding: 4px 8px;
  background-color: ${colors.bg.input};
  color: ${colors.white};
  border: 1px solid #445;
  border-radius: 4px;
  font-size: 13px;
`;

const exitBtn = css`
  ${btn};
  background-color: ${colors.accent.red};
  &:hover {
    background-color: ${colors.accent.darkRed};
  }
`;

const spacer = css`
  flex: 1;
`;

export function ReplayControls({
  step,
  total,
  seat,
  seats,
  playing,
  speed,
  onPrev,
  onNext,
  onGoTo,
  onTogglePlay,
  onSetSpeed,
  onSetSeat,
  onExit,
}: ReplayControlsProps) {
  return (
    <div className={bar}>
      <span className={label}>▶ 重播模式</span>

      <button className={btn} onClick={onPrev} disabled={step <= 0} title="上一步">
        ⏮ 上一步
      </button>
      <button className={playBtn} onClick={onTogglePlay}>
        {playing ? '⏸ 暂停' : '▶ 播放'}
      </button>
      <button className={btn} onClick={onNext} disabled={step >= total} title="下一步">
        下一步 ⏭
      </button>

      <input
        type="range"
        className={progress}
        min={0}
        max={total}
        value={step}
        onChange={(e) => onGoTo(Number(e.target.value))}
      />
      <span>
        {step} / {total}
      </span>

      <div className={speedGroup}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={s === speed ? speedBtnActive : speedBtn}
            onClick={() => onSetSpeed(s)}
          >
            {s}x
          </button>
        ))}
      </div>

      {seats.length > 1 && (
        <select
          className={seatSelect}
          value={seat}
          onChange={(e) => onSetSeat(Number(e.target.value))}
          title="切换视角"
        >
          {seats.map((s) => (
            <option key={s} value={s}>
              座次 {s}
            </option>
          ))}
        </select>
      )}

      <span className={spacer} />
      <button className={exitBtn} onClick={onExit}>
        退出重播
      </button>
    </div>
  );
}
