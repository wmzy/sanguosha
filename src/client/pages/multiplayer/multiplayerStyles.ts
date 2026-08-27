// src/client/pages/multiplayer/multiplayerStyles.ts
// 多人游戏页共用样式与常量表(自 MultiplayerPage.tsx 原样搬移)。
// 供各 stage 子组件(lobby/waiting/playing/spectating/ended/notFound)按需取用。
import { css } from '@linaria/core';
import { colors, pageStyle, pageBgStyle, glassPanelStyle, goldHeadingStyle, goldColors } from '../../theme';
import type { GameMode } from '../../../engine/rules/types';

// wyw-in-js 下 css`` 内插值其他 css 类(如 ${pageBgStyle})不会内联其属性,
// 统一改为「自身属性类 + 基类字符串拼接」导出,使用处 className 零改动。
const pageBase = css`
  background-color: #0d1220;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  padding: 40px 20px;
  color: #eee;
`;
export const page = `${pageBase} ${pageBgStyle}`;

/** 页面主标题:金色 + 底部金色下边线 */
const titleBase = css`
  font-size: 36px;
  margin: 0 0 8px;
  letter-spacing: 4px;
  color: ${goldColors.base};
`;
export const title = `${titleBase} ${goldHeadingStyle}`;

export const subtitle = css`
  color: ${colors.text.muted};
  margin: 0 0 32px;
`;

/** 等待大厅页标题:金书风 + 两侧装饰渐变线(同选将面板标题做法,官方 OL 风格)。
 *  与 `title`(底部下划线式)并存,按页面选用。 */
export const pageTitle = css`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  font-size: 34px;
  font-weight: bold;
  margin: 0 0 8px;
  letter-spacing: 6px;
  color: #e8c47a;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
  /* 防止窄容器下文字被逐字换行成竖排 */
  white-space: nowrap;

  &::before,
  &::after {
    content: '';
    flex: 0 1 160px;
    max-width: 220px;
    min-width: 24px;
    height: 7px;
    background:
      linear-gradient(#e8c47a, #e8c47a) right center / 5px 5px no-repeat,
      linear-gradient(90deg, transparent, #8a7448) left center / calc(100% - 9px) 2px no-repeat;
  }

  &::after {
    transform: scaleX(-1);
  }
`;

const cardBase = css`
  padding: 28px;
  width: 100%;
  max-width: 420px;
`;
export const card = `${cardBase} ${glassPanelStyle}`;

/** 区块标题:左侧金色竖条 */
export const sectionTitle = css`
  font-size: 18px;
  font-weight: bold;
  margin: 0 0 16px;
  color: ${goldColors.light};
  display: flex;
  align-items: center;
  gap: 8px;

  &::before {
    content: '';
    flex-shrink: 0;
    width: 3px;
    height: 16px;
    border-radius: 2px;
    background: linear-gradient(180deg, ${goldColors.base}, ${goldColors.deep});
  }
`;

export const formRow = css`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
`;

export const label = css`
  font-size: 13px;
  color: ${colors.text.secondary};
`;

export const divider = css`
  border: none;
  height: 1px;
  background: linear-gradient(90deg, rgba(241, 196, 15, 0.28), rgba(241, 196, 15, 0.04));
  margin: 24px 0;
`;

/** 房间码盒:官方铜牌风(暗皮革底 + 铜边 + 内阴影) */
export const roomCodeBox = css`
  background: linear-gradient(#241d15, #171209);
  border: 1px solid #8a7448;
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  margin-bottom: 20px;
  box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.5);
`;

export const roomCodeLabel = css`
  font-size: 12px;
  color: ${colors.text.muted};
  margin-bottom: 6px;
`;

/** 房间码数字:#ffd700 22px 加粗等宽 */
export const roomCode = css`
  font-size: 22px;
  font-weight: bold;
  letter-spacing: 6px;
  color: #ffd700;
  font-family: monospace;
`;

/** 房间码下方复制按钮行:居中排布、小巧,不喧宾夺主 */
export const copyBtnRow = css`
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 12px;
`;

export const readyInfo = css`
  text-align: center;
  margin-bottom: 20px;
  font-size: 15px;
  color: ${colors.text.secondary};
`;

export const configGrid = css`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 24px;
  background-color: ${colors.bg.input};
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 20px;
  font-size: 13px;
`;

export const configItem = css`
  display: flex;
  justify-content: space-between;
  gap: 8px;
`;

export const configKey = css`
  color: ${colors.text.muted};
`;

export const configVal = css`
  color: ${colors.text.primary};
  font-weight: bold;
`;

export const GAME_MODE_OPTIONS: Array<{ label: string; value: GameMode }> = [
  { label: '身份局（经典 2-8 人）', value: '身份局' },
  { label: '1v1 对决（两人速战）', value: '1v1' },
];

export const GAME_MODE_LABELS: Record<string, string> = {
  身份局: '身份局',
  '1v1': '1v1 对决',
};

export const POOL_LABELS: Record<string, string> = {

  standard: '标准池 (~32人)',
  extended: '扩展池',
  all: '全武将 (60人)',
};

export const TIMEOUT_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '快 (15s)', value: 15 },
  { label: '标准 (30s)', value: 30 },
  { label: '慢 (60s)', value: 60 },
  { label: '无限', value: 0 },
];

export function timeoutLabel(v: number): string {
  if (v <= 0) return '无限';
  return `${v}s`;
}

export const buttonRow = css`
  display: flex;
  gap: 12px;
  justify-content: center;
`;

/** 结算回退卡(EndedStage 无 view 时):居中文案 + card 卡片样式。
 *  原 css`` 内插值 ${card} 在 wyw 下不内联规则(非法声明),改为字符串拼接。 */
const gameOverBoxBase = css`
  text-align: center;
`;
export const gameOverBox = `${gameOverBoxBase} ${card}`;

export const winnerText = css`
  font-size: 28px;
  font-weight: bold;
  margin: 16px 0;
  color: ${colors.accent.gold};
`;

const gameWrapBase = css`
  min-height: 100vh;
  background-color: ${colors.bg.page};
`;
export const gameWrap = `${gameWrapBase} ${pageBgStyle}`;

/**
 * lobby 页容器:顶栏贴顶常驻,主体两栏(左表单/右房间列表)限宽居中。
 * 与 `page` 的居中单列范式分开,避免影响游戏结束等居中分支。
 */
const lobbyPageBase = css`
  background-color: #0d1220;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  color: #eee;
`;
export const lobbyPage = `${lobbyPageBase} ${pageBgStyle}`;

/** 顶栏:sticky 常驻页面顶部,左侧返回首页,右侧页面标识 */
export const topBar = css`
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  background-color: rgba(13, 18, 32, 0.85);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(241, 196, 15, 0.16);
`;

/** 顶栏返回按钮:金色描边幽灵按钮(独立于 btnStyle,避免 border 声明顺序不稳) */
export const topBarBtn = css`
  padding: 6px 18px;
  background-color: rgba(241, 196, 15, 0.12);
  color: ${goldColors.light};
  border: 1px solid rgba(241, 196, 15, 0.35);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: bold;
  transition: background-color 0.15s;

  &:hover {
    background-color: rgba(241, 196, 15, 0.24);
  }
`;

/** 顶栏右侧页面标识:淡金小字,撑到最右 */
export const topBarTag = css`
  margin-left: auto;
  font-size: 13px;
  letter-spacing: 3px;
  color: ${goldColors.soft};
`;

/** 主体两栏:左列创建/加入表单,右列房间列表;窄屏退化为单列(列表在下) */
export const lobbyLayout = css`
  display: grid;
  grid-template-columns: minmax(0, 460px) minmax(300px, 400px);
  gap: 48px;
  justify-content: center;
  align-items: start;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 24px 48px;

  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 460px);
  }
`;

/** 左列:标题 + 表单卡 */
export const lobbyMain = css`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

/** 右列房间列表:主内容较长时吸附视口跟随滚动 */
export const lobbySide = css`
  position: sticky;
  top: 84px;
  max-height: calc(100vh - 108px);
  overflow-y: auto;

  @media (max-width: 960px) {
    position: static;
    max-height: none;
  }
`;

/** 重连提示覆盖层(非阻塞,固定顶部) */
export const reconnectOverlay = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: bold;
  color: #fff;
  pointer-events: auto;
  background-color: ${colors.accent.amber};
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
`;

/** 重连失败横幅:reconnectOverlay 布局 + 红色底覆盖。
 *  原 css`` 内插值 ${reconnectOverlay} 在 wyw 下不内联规则(非法声明),改为字符串拼接;
 *  本类声明在其后,background-color 按样式表顺序覆盖琥珀色。 */
const reconnectFailedBase = css`
  background-color: ${colors.accent.red};
`;
export const reconnectFailedOverlay = `${reconnectOverlay} ${reconnectFailedBase}`;

export const reconnectSpinner = css`
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const notFoundPageBase = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  text-align: center;
  gap: 12px;
`;
export const notFoundPage = `${pageStyle} ${pageBgStyle} ${notFoundPageBase}`;

export const notFoundCode = css`
  font-size: 96px;
  font-weight: bold;
  color: ${colors.accent.red};
  line-height: 1;
  letter-spacing: 4px;
`;

export const notFoundTitle = css`
  font-size: 24px;
  font-weight: bold;
  color: ${colors.text.primary};
`;

export const notFoundDesc = css`
  font-size: 15px;
  color: ${colors.text.secondary};
  max-width: 400px;
`;

export const notFoundRoomId = css`
  font-family: monospace;
  color: ${colors.accent.gold};
  font-weight: bold;
  letter-spacing: 2px;
`;
