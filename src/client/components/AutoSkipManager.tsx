// src/client/components/AutoSkipManager.tsx
// 自动跳过管理面板:列出用户已勾选「自动跳过此类询问」的项,支持随时取消。
//
// 背景:原 checkbox 仅在对应 pending 出现时显示(AwaitingPrompt 内),pending 一旦消失
// 用户就无法取消已勾选的项。本组件提供常驻入口,默认折叠为小按钮,hover 展开列表逐项取消。
//
// 内嵌于顶部栏工具组(与 SoundControl 并排)。无勾选项时不渲染。

import { css } from '@linaria/core';
import type { AutoSkipPrefs } from '../utils/autoSkip';

const managerWrap = css`
  position: relative;
  display: inline-flex;
  align-items: center;
  /* hover 或键盘 focus-within 时展开下拉(:focus-within 让 Tab 键也可访问) */
  &:hover [data-autoskip-dropdown],
  &:focus-within [data-autoskip-dropdown] {
    display: block;
  }
`;

const triggerBtn = css`
  border: 1px solid #555;
  border-radius: 4px;
  padding: 3px 6px;
  cursor: pointer;
  background: transparent;
  color: #e0e0e0;
  font-size: 14px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  &:hover {
    border-color: #ffd700;
    color: #ffd700;
  }
`;

const badge = css`
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 8px;
  background: #ffd700;
  color: #1a1a1a;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  line-height: 15px;
`;

const dropdown = css`
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 1000;
  min-width: 200px;
  padding: 8px;
  background: rgba(28, 23, 18, 0.97);
  border: 1px solid #555;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  color: #ddd;
  font-size: 12px;
`;

const dropdownTitle = css`
  margin: 0 0 6px;
  color: #aaa;
  font-size: 11px;
`;

const entry = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  &:last-child {
    border-bottom: none;
  }
`;

const entryName = css`
  color: #e0e0e0;
`;

const cancelBtn = css`
  border: none;
  background: transparent;
  color: #e88080;
  cursor: pointer;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  &:hover {
    background: rgba(232, 128, 128, 0.15);
    color: #ffaaaa;
  }
`;

export interface AutoSkipManagerProps {
  prefs: AutoSkipPrefs;
  /** 切换指定 requestType 的勾选状态(已勾选 → 取消) */
  onToggle: (requestType: string) => void;
}

/**
 * 自动跳过管理面板。
 *
 * 从 prefs.optInSkip 提取已勾选(true)的项,hover 展开列表,逐项可取消。
 * 无勾选时不渲染(避免空入口)。
 */
export function AutoSkipManager({ prefs, onToggle }: AutoSkipManagerProps) {
  const entries = Object.entries(prefs.optInSkip).filter(([, v]) => v);
  if (entries.length === 0) return null;
  return (
    <div className={managerWrap}>
      <button
        className={triggerBtn}
        title="已开启的自动跳过(hover 查看 / 取消)"
        aria-label={`自动跳过管理,${entries.length} 项`}
      >
        ⏭<span className={badge}>{entries.length}</span>
      </button>
      <div className={dropdown} data-autoskip-dropdown>
        <p className={dropdownTitle}>已开启自动跳过 — 点击取消</p>
        {entries.map(([reqType]) => (
          <div className={entry} key={reqType}>
            <span className={entryName}>{reqType}</span>
            <button className={cancelBtn} onClick={() => onToggle(reqType)}>
              取消
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
