// src/client/pages/multiplayer/multiplayerStyles.ts
// 多人游戏页共用样式与常量表(自 MultiplayerPage.tsx 原样搬移)。
// 供各 stage 子组件(lobby/waiting/playing/spectating/ended/notFound)按需取用。
import { css } from '@linaria/core';
import { colors, pageStyle, pageBgStyle, glassPanelStyle, goldHeadingStyle, goldColors } from '../../theme';
import type { GameMode } from '../../../engine/rules/types';

export const page = css`
  ${pageBgStyle}
  background-color: #0d1220;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  padding: 40px 20px;
  color: #eee;
`;

/** 页面主标题:金色 + 底部金色下边线 */
export const title = css`
  ${goldHeadingStyle}
  font-size: 36px;
  margin: 0 0 8px;
  letter-spacing: 4px;
  color: ${goldColors.base};
`;

export const subtitle = css`
  color: ${colors.text.muted};
  margin: 0 0 32px;
`;

export const card = css`
  ${glassPanelStyle}
  padding: 28px;
  width: 100%;
  max-width: 420px;
`;

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

export const roomCodeBox = css`
  background-color: rgba(18, 24, 40, 0.6);
  border: 2px dashed rgba(241, 196, 15, 0.45);
  border-radius: 10px;
  padding: 20px;
  text-align: center;
  margin-bottom: 20px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
`;

export const roomCodeLabel = css`
  font-size: 12px;
  color: ${colors.text.muted};
  margin-bottom: 6px;
`;

export const roomCode = css`
  font-size: 32px;
  font-weight: bold;
  letter-spacing: 6px;
  color: ${colors.accent.gold};
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

export const gameOverBox = css`
  ${card}
  text-align: center;
`;

export const winnerText = css`
  font-size: 28px;
  font-weight: bold;
  margin: 16px 0;
  color: ${colors.accent.gold};
`;

export const gameWrap = css`
  min-height: 100vh;
  ${pageBgStyle}
  background-color: ${colors.bg.page};
`;

/**
 * lobby 页容器:顶栏贴顶常驻,主体两栏(左表单/右房间列表)限宽居中。
 * 与 `page` 的居中单列范式分开,避免影响游戏结束等居中分支。
 */
export const lobbyPage = css`
  ${pageBgStyle}
  background-color: #0d1220;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  color: #eee;
`;

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

export const reconnectFailedOverlay = css`
  ${reconnectOverlay}
  background-color: ${colors.accent.red};
`;

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

export const notFoundPage = css`
  ${pageStyle}
  ${pageBgStyle}
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  text-align: center;
  gap: 12px;
`;

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
