// src/client/components/SoundControl.tsx
// 音效控制面板:静音开关 + 音量滑块。
//
// 内嵌于 GameHeader 右侧工具组(与资源包按钮并排,位于顶部栏右上角)。
// 状态由 useSoundSettings 管理(localStorage 持久化 + audioEngine 同步)。
//
// 设计:
//   - 默认收起为一个小喇叭图标按钮(🔊/🔇),双击展开音量滑块
//   - 展开后显示音量滑块 + 静音切换
//   - 无独立背景,继承 headerBar 的半透明底色

import { useState, useCallback } from 'react';
import { css } from '@linaria/core';
import { useSoundSettings } from '../hooks/useSoundSettings';

// ─── 样式 ───
const controlWrap = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #ddd;
  user-select: none;
`;

const muteBtn = css`
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 4px;
  color: #ddd;
  &:hover {
    color: #ffd700;
  }
`;

const volumeSlider = css`
  width: 80px;
  height: 4px;
  cursor: pointer;
  accent-color: #e67e22;
`;

const volumeLabel = css`
  min-width: 28px;
  text-align: right;
  color: #95a5a6;
  font-variant-numeric: tabular-nums;
`;

/**
 * 音效控制组件。
 * 自包含:内部使用 useSoundSettings 管理状态,不需外部 props。
 */
export function SoundControl() {
  const { muted, volume, setMuted, setVolume, toggleMute } = useSoundSettings();
  const [expanded, setExpanded] = useState(false);

  const handleToggleExpand = useCallback(() => {
    setExpanded((e) => !e);
  }, []);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setVolume(Number(e.target.value));
    },
    [setVolume],
  );

  // 静音或音量为 0 时显示 🔇,否则 🔊
  const icon = muted || volume === 0 ? '🔇' : '🔊';

  return (
    <div className={controlWrap}>
      <button
        className={muteBtn}
        onClick={toggleMute}
        onDoubleClick={handleToggleExpand}
        title={muted ? '已静音(点击取消静音)' : '点击静音 · 双击展开音量'}
        aria-label={muted ? '取消静音' : '静音'}
      >
        {icon}
      </button>
      {expanded && (
        <>
          <input
            className={volumeSlider}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={handleVolumeChange}
            aria-label="音量"
          />
          <span className={volumeLabel}>
            {Math.round((muted ? 0 : volume) * 100)}%
          </span>
        </>
      )}
    </div>
  );
}
