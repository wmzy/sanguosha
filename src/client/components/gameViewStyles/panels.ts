// 覆盖层与信息面板样式:Debug 面板 + 日志面板 + 选将等待遮罩 + 已选武将卡 + Debug 快照。

import { css } from '@linaria/core';

// ─── Debug panel ───
export const debugPanel = css`
  margin-top: 16px;
  border: 1px solid #333;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
`;
export const debugSummary = css`
  padding: 8px 12px;
  cursor: pointer;
  color: #888;
  font-size: 12px;
`;
export const debugContent = css`
  padding: 8px 12px;
  font-size: 12px;
  color: #aaa;
  font-family: monospace;
`;
export const debugHr = css`
  border: none;
  border-top: 1px solid #333;
  margin: 8px 0;
`;
export const debugPlayer = css`
  margin-bottom: 4px;
`;
export const debugDead = css`
  text-decoration: line-through;
  opacity: 0.5;
`;

// ─── Log panel ───
export const logPanel = css`
  margin-top: 12px;
  border: 1px solid #333;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
`;
export const logSummary = css`
  padding: 8px 12px;
  cursor: pointer;
  color: #888;
  font-size: 12px;
`;
export const logContent = css`
  padding: 8px 12px;
  font-size: 12px;
  color: #aaa;
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column-reverse;
`;
export const logEmpty = css`
  color: #555;
  font-style: italic;
  text-align: center;
`;
export const logEntry = css`
  display: flex;
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
`;
export const logTime = css`
  color: #666;
  min-width: 40px;
  flex-shrink: 0;
`;
export const logPlayer = css`
  color: #3498db;
  font-weight: bold;
  min-width: 40px;
  flex-shrink: 0;
`;
export const logText = css`
  color: #ccc;
`;

// ─── 选将等待遮罩(并行选将:当前视角玩家已选完但其他人还在选)───
export const charSelectWaitingOverlay = css`
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.9);
  color: #f1c40f;
  font-size: 18px;
  gap: 12px;
`;
export const charSelectWaitingSub = css`
  font-size: 13px;
  color: #aaa;
`;
export const charSelectWaitingCountdown = css`
  width: 300px;
  margin-top: 8px;
`;
export const charSelectWaitingSwitchBtn = css`
  margin-top: 16px;
  padding: 8px 18px;
  font-size: 14px;
  font-weight: bold;
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  cursor: pointer;
`;

// ─── 已选武将卡(选将完成后展示在等待遮罩中,明确反馈选择结果)───
// 立绘作整张卡背景,文字内容浮在其上
export const selectedCharCard = css`
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0;
  border-radius: 12px;
  box-shadow:
    0 4px 24px rgba(255, 215, 0, 0.25),
    0 4px 16px rgba(0, 0, 0, 0.4);
  border: 2px solid rgba(255, 215, 0, 0.6);
  min-width: 220px;
  width: 220px;
  height: 300px;
  overflow: hidden;
  background: var(--faction-color, #8e44ad);
`;
// 立绘背景:绝对填满卡牌
export const selectedCharPortrait = css`
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.35);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
`;
export const selectedCharPortraitImg = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
`;
// 文字内容层:底部渐变蒙版覆盖在立绘上
export const selectedCharMeta = css`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 18px 18px;
  margin-top: auto;
  width: 100%;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.85) 0%,
    rgba(0, 0, 0, 0.55) 60%,
    rgba(0, 0, 0, 0) 100%
  );
`;
export const selectedCharLabel = css`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 2px;
`;
export const selectedCharName = css`
  font-size: 28px;
  font-weight: bold;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
`;
export const selectedCharFaction = css`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(0, 0, 0, 0.25);
  border-radius: 6px;
  padding: 3px 10px;
`;
export const selectedCharSkills = css`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  text-align: center;
`;
export const selectedCharHpRow = css`
  display: flex;
  gap: 4px;
  margin-top: 2px;
`;
// 已选武将卡体力点(选将/等待遮罩共用)
export const selectedCharHpDot = css`
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e74c3c;
  box-shadow: 0 0 4px rgba(231, 76, 60, 0.5);
`;

// ─── Debug 快照 ───
export const snapshotBtn = css`
  background: #2d4a2d;
  color: #7ee787;
  border: 1px solid #4a8a4a;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  &:hover {
    background: #3d5a3d;
  }
  &:disabled {
    opacity: 0.5;
    cursor: wait;
  }
`;
export const snapshotToast = css`
  position: fixed;
  top: 50px;
  left: 50%;
  transform: translateX(-50%);
  background: #1f3d1f;
  color: #7ee787;
  padding: 10px 20px;
  border-radius: 6px;
  border: 1px solid #4a8a4a;
  font-size: 13px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 10px;
`;
export const copyBtn = css`
  background: #2d4a2d;
  color: #7ee787;
  border: 1px solid #4a8a4a;
  padding: 2px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  &:hover {
    background: #3d5a3d;
  }
`;
export const copyBtnDone = css`
  background: #1a3d1a;
  border-color: #2a6a2a;
  cursor: default;
`;
export const snapshotErrorToast = css`
  position: fixed;
  top: 50px;
  left: 50%;
  transform: translateX(-50%);
  background: #3d1f1f;
  color: #ff7b72;
  padding: 10px 20px;
  border-radius: 6px;
  border: 1px solid #8a4a4a;
  font-size: 13px;
  z-index: 9999;
`;
