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

// ─── 全局重置:body 默认 margin 和背景色 ───
export const globalReset = css`
  :global(body) {
    margin: 0;
    background-color: ${colors.bg.page};
  }
`;

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

// ─── 视觉升级 token:深色卡牌质感(只增不删,纯 CSS 离线可用) ───

/** 金色主强调色系(accent.gold 的深浅/透明变体) */
export const goldColors = {
  light: '#ffe9a0',
  base: colors.accent.gold,
  soft: '#d4a017',
  deep: '#9a7208',
  faint: 'rgba(241, 196, 15, 0.12)',
  border: 'rgba(241, 196, 15, 0.32)',
} as const;

/** 阴影层级 token */
export const shadows = {
  panel: '0 8px 24px rgba(0, 0, 0, 0.35)',
  raise: '0 14px 36px rgba(0, 0, 0, 0.5)',
  glow: '0 0 18px rgba(241, 196, 15, 0.18)',
} as const;

/**
 * 页面背景:深蓝黑径向渐变层次。
 * 只含 background-image(不含 background-color),可与任意底色组合;
 * 需要深底时由使用方自行设置 background-color(如 #0d1220)。
 */
export const pageBgStyle = css`
  background-image:
    radial-gradient(1100px 620px at 50% -12%, rgba(58, 74, 120, 0.38), transparent 62%),
    radial-gradient(900px 520px at 86% 112%, rgba(122, 92, 40, 0.16), transparent 66%),
    radial-gradient(720px 420px at 6% 92%, rgba(40, 60, 100, 0.24), transparent 62%);
  background-attachment: fixed;
  background-repeat: no-repeat;
`;

/** 玻璃质感面板:半透明背景 + 模糊 + 1px 亮边框(圆角/内边距由使用方控制) */
export const glassPanelStyle = css`
  background-color: rgba(28, 36, 58, 0.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(241, 196, 15, 0.16);
  border-radius: 14px;
  box-shadow: ${shadows.panel};
`;

/** 页面主标题装饰:底部金色渐隐下边线(宽度固定 140px,不随标题拉伸) */
export const goldHeadingStyle = css`
  padding-bottom: 10px;
  background-image: linear-gradient(90deg, ${goldColors.soft}, rgba(241, 196, 15, 0));
  background-size: 140px 2px;
  background-position: 0 100%;
  background-repeat: no-repeat;
`;
