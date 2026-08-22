// src/client/components/NarrowScreenHint.tsx
// 窄屏提示条:视口宽度 ≤900px 时,在页面顶部显示不阻断的提示「当前窗口较窄,建议桌面浏览器游玩」。
// 游戏画布已改为等比缩放(GameViewScaler),窄窗口下整体缩小仍可玩,但过小屏幕可读性差,故保留提示。
//   - 不阻断交互:整条 pointer-events: none,点击穿透到下方 UI,仅关闭按钮可点。
//   - 不参与滚动:position: fixed 固定于视口顶部,滚动不带走。
//   - 宽屏零影响:matchMedia 驱动条件渲染,宽屏完全不挂载(非 CSS 隐藏)。
//   - 可手动关闭:关闭后本次会话不再出现(组件常驻 App 不随路由卸载,会话级 state,不持久化)。
import { useEffect, useState } from 'react';
import { css } from '@linaria/core';
import { colors } from '../theme';

/** 与 gameViewStyles(layout/actionBar)的 @media (max-width: 900px) 断点对齐 */
const NARROW_QUERY = '(max-width: 900px)';

const bar = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9500; /* 高于常规游戏 UI(header 1000 / 聊天 9000),低于全屏遮罩(9998+) */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 44px;
  background: rgba(13, 18, 32, 0.92);
  border-bottom: 1px solid ${colors.accent.amber};
  color: ${colors.text.secondary};
  font-size: 13px;
  font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
  pointer-events: none; /* 提示条本体不拦截点击,交互穿透到下方页面 */
`;

const closeBtn = css`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: auto; /* 仅关闭按钮可点 */
  border: none;
  background: transparent;
  color: ${colors.text.muted};
  font-size: 16px;
  line-height: 1;
  padding: 4px 8px;
  cursor: pointer;

  &:hover {
    color: ${colors.text.primary};
  }
`;

export function NarrowScreenHint() {
  // 初始值按当前视口求值,避免首帧闪烁;本项目为纯浏览器 SPA(vite),无 SSR 顾虑。
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // 关闭后本次会话内不再显示:dismissed 优先于后续的窄屏变化。
  if (!narrow || dismissed) return null;
  return (
    <div className={bar} role="status">
      当前窗口较窄,建议桌面浏览器游玩
      <button
        type="button"
        className={closeBtn}
        aria-label="关闭提示"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
