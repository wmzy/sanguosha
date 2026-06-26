import { css } from '@linaria/core';

export const colors = {
  bg: {
    page: '#1a1a2e',
    panel: '#2c3e50',
    input: '#34495e',
    nav: '#16213e',
    playerSelf: '#2c3e50',
    playerOther: '#1a252f',
  },
  text: {
    primary: '#eee',
    secondary: '#bdc3c7',
    muted: '#95a5a6',
    dim: '#7f8c8d',
    input: '#ecf0f1',
  },
  accent: {
    red: '#e74c3c',
    darkRed: '#c0392b',
    green: '#2ecc71',
    greenDark: '#27ae60',
    blue: '#3498db',
    orange: '#e67e22',
    amber: '#f39c12',
    gold: '#f1c40f',
    purple: '#8e44ad',
    purpleLight: '#9b59b6',
  },
  card: {
    playable: '#2c3e50',
    selected: '#34495e',
    discardSelected: '#4a235a',
    borderPlayable: '#555',
    borderSelected: '#e74c3c',
    borderDiscard: '#8e44ad',
    borderDefault: '#333',
  },
  disabled: '#555',
  white: 'white',
  overlay: 'rgba(0,0,0,0.8)',
} as const;

// ─── 页面/按钮/输入/提示通用样式(原 theme.ts styles 工厂,迁至 linaria css) ───
// 动态值(padding/背景色等)通过 CSS 自定义属性传入,使用时:
//   className={btnStyle} style={{ '--btn-bg': colors.accent.green } as React.CSSProperties}

/** 页面容器。padding 由 --page-padding 控制(默认 20px)。 */
export const pageStyle = css`
  padding: var(--page-padding, 20px);
  background-color: #1a1a2e;
  min-height: 100vh;
  color: #eee;
`;

/** 通用按钮。bg/padding/fontSize/cursor 由 CSS 变量控制。 */
export const btnStyle = css`
  padding: var(--btn-padding, 8px 24px);
  background-color: var(--btn-bg, #555);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: var(--btn-cursor, pointer);
  font-size: var(--btn-font-size, 14px);
  font-weight: bold;
`;

/** 通用输入框(无参数,纯静态)。 */
export const inputStyle = css`
  width: 100%;
  padding: 10px 12px;
  background-color: #34495e;
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 14px;
`;

/** 错误提示 toast(固定右上角,无参数)。 */
export const errorToastStyle = css`
  position: fixed;
  top: 20px;
  right: 20px;
  background-color: #e74c3c;
  padding: 15px 25px;
  border-radius: 8px;
  z-index: 1000;
`;
