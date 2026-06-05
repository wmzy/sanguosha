import { colors } from '../theme';

export interface ReplayControlsProps {
  currentStep: number;
  totalSteps: number;
  speed: number;
  isPlaying: boolean;
  perspectives: string[];
  selectedPerspective: string;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (step: number) => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: number) => void;
  onPerspectiveChange: (player: string) => void;
  onClose: () => void;
}

const speeds = [0.5, 1, 2];

export function ReplayControls({
  currentStep,
  totalSteps,
  speed,
  isPlaying,
  perspectives,
  selectedPerspective,
  onPrev,
  onNext,
  onGoTo,
  onTogglePlay,
  onSpeedChange,
  onPerspectiveChange,
  onClose,
}: ReplayControlsProps) {
  const atStart = currentStep === 0;
  const atEnd = currentStep >= totalSteps - 1;

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <button
          onClick={onPrev}
          disabled={atStart}
          style={btnStyle(atStart)}
          aria-label="上一步"
        >
          ◀ 上一步
        </button>

        <button
          onClick={onTogglePlay}
          style={playBtnStyle}
          aria-label={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? '⏸ 暂停' : '▶ 播放'}
        </button>

        <button
          onClick={onNext}
          disabled={atEnd}
          style={btnStyle(atEnd)}
          aria-label="下一步"
        >
          下一步 ▶
        </button>

        <select
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          style={selectStyle}
          aria-label="播放速度"
        >
          {speeds.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>

        {perspectives.length > 1 && (
          <select
            value={selectedPerspective}
            onChange={(e) => onPerspectiveChange(e.target.value)}
            style={selectStyle}
            aria-label="切换视角"
          >
            {perspectives.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}

        <button onClick={onClose} style={closeBtnStyle} aria-label="关闭">
          ✕ 关闭
        </button>
      </div>

      <div style={sliderRowStyle}>
        <span style={stepLabelStyle}>
          {currentStep + 1} / {totalSteps}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(totalSteps - 1, 0)}
          value={currentStep}
          onChange={(e) => onGoTo(Number(e.target.value))}
          style={sliderStyle}
          aria-label="进度条"
        />
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 12px',
  backgroundColor: colors.bg.panel,
  borderRadius: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const baseBtn: React.CSSProperties = {
  padding: '6px 12px',
  border: 'none',
  borderRadius: 4,
  fontSize: 13,
  cursor: 'pointer',
  color: colors.white,
};

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    ...baseBtn,
    backgroundColor: disabled ? colors.disabled : colors.accent.blue,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

const playBtnStyle: React.CSSProperties = {
  ...baseBtn,
  backgroundColor: colors.accent.green,
  minWidth: 80,
};

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  backgroundColor: colors.bg.input,
  color: colors.text.primary,
  border: `1px solid ${colors.disabled}`,
  fontSize: 13,
};

const closeBtnStyle: React.CSSProperties = {
  ...baseBtn,
  backgroundColor: colors.accent.red,
  marginLeft: 'auto',
};

const sliderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const sliderStyle: React.CSSProperties = {
  flex: 1,
  accentColor: colors.accent.blue,
};

const stepLabelStyle: React.CSSProperties = {
  color: colors.text.secondary,
  fontSize: 13,
  minWidth: 60,
};
