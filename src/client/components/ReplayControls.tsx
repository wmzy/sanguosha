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

/** 播放/暂停主按钮:复用 btn 外观,绿色底色突出(自身属性后声明,覆盖 btn 默认底色/hover)。
 *  原 css`` 内插值 ${btn} 在 wyw 下不内联规则(非法声明),改为字符串拼接。 */
const playBtnExtra = css`
  background-color: ${colors.accent.green};
  &:hover {
    background-color: ${colors.accent.greenDark};
  }
`;
const playBtn = `${btn} ${playBtnExtra}`;

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

/** 当前速度档:复用 speedBtn 外观,蓝色底 + 白字高亮(后声明覆盖 speedBtn 默认)。
 *  原 css`` 内插值 ${speedBtn} 在 wyw 下不内联规则(非法声明),改为字符串拼接。 */
const speedBtnActiveExtra = css`
  background-color: ${colors.accent.blue};
  color: ${colors.white};
`;
const speedBtnActive = `${speedBtn} ${speedBtnActiveExtra}`;

const seatSelect = css`
  padding: 4px 8px;
  background-color: ${colors.bg.input};
  color: ${colors.white};
  border: 1px solid #445;
  border-radius: 4px;
  font-size: 13px;
`;

/** 退出按钮:复用 btn 外观,红色底色警示(自身属性后声明,覆盖 btn 默认底色/hover)。
 *  原 css`` 内插值 ${btn} 在 wyw 下不内联规则(非法声明),改为字符串拼接。 */
const exitBtnExtra = css`
  background-color: ${colors.accent.red};
  &:hover {
    background-color: ${colors.accent.darkRed};
  }
`;
const exitBtn = `${btn} ${exitBtnExtra}`;

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
              {s < 0 ? '旁观视角' : `座次 ${s}`}
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
