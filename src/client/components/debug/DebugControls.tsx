// src/components/debug/DebugControls.tsx — 调试大厅顶部导航
//
// T10 拆分：把 DebugLobby 中的顶部导航栏（返回 / 删除房间 / 调试游戏标签）抽出来。
// 两套视图共用，差异仅在 `onDeleteRoom` 是否提供。

import { css } from '@linaria/core';
import { colors } from '../../theme';

interface DebugControlsProps {
  /** "← 退出" / "← 返回" 按钮的回调 */
  onBack: () => void;
  /** "删除房间" 按钮回调；undefined = 不渲染该按钮（仅在游戏进行中显示） */
  onDeleteRoom?: () => void;
}

const navBar = css`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background-color: ${colors.bg.nav};
  border-bottom: 1px solid ${colors.bg.input};
`;

const navLink = css`
  color: ${colors.accent.blue};
  text-decoration: none;
  font-size: 14px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
`;

const navLabel = css`
  color: ${colors.text.muted};
`;

export function DebugControls({ onBack, onDeleteRoom }: DebugControlsProps) {
  return (
    <nav className={navBar}>
      <button onClick={onBack} className={navLink}>
        ← 返回
      </button>
      {onDeleteRoom && (
        <button onClick={onDeleteRoom} className={navLink}>
          删除房间
        </button>
      )}
      <span className={navLabel}>调试游戏</span>
    </nav>
  );
}
