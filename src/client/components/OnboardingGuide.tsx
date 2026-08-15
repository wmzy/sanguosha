// src/client/components/OnboardingGuide.tsx
// 新手引导：等待大厅内轻量静态图文教程。
// 收起态是一行小入口按钮；展开态为四个短节的纯文本说明面板。
// 首次进房（localStorage 无 'sgs_onboarding_shown'）默认展开一次，关闭时写入标记，之后默认收起。
import { useState, useCallback } from 'react';
import { css } from '@linaria/core';
import { colors, goldColors } from '../theme';

/** localStorage 标记 key：存在即表示已经看过一次引导 */
const SHOWN_KEY = 'sgs_onboarding_shown';

/** 教程内容：静态数据，四节（基本目标 / 出牌三步 / 被询问时 / 实用技巧） */
const SECTIONS: Array<{ icon: string; title: string; items: string[] }> = [
  {
    icon: '🎯',
    title: '基本目标',
    items: [
      '身份局中每人有隐藏身份：主公要消灭所有反贼，反贼要推翻主公，忠臣保护主公。',
      '内奸是孤狼：先帮主公清场，最后单挑主公才能独赢。',
      '主公身份公开，其余身份只在游戏结束后揭晓——留意谁在明着攻击主公。',
    ],
  },
  {
    icon: '🀄',
    title: '出牌三步',
    items: [
      '① 选手牌：点击手中可出的牌（可出的牌会有高亮提示）。',
      '② 选目标：点击场上对应座位选定目标（有的牌不需要目标）。',
      '③ 点「出牌」：确认出牌，生效后进入结算。',
    ],
  },
  {
    icon: '🛡️',
    title: '被询问时',
    items: [
      '别人对你出「杀」等牌时会被询问回应：选中高亮的手牌（如「闪」）→ 点「打出」。',
      '没有能回应的牌时，点「不回应」直接跳过，不必干等。',
      '倒计时结束仍未操作会按默认选择自动结算，不会卡住全局。',
    ],
  },
  {
    icon: '💡',
    title: '实用技巧',
    items: [
      '技能按钮上悬停（或长按）即可查看技能说明，先读技能再行动。',
      '顶部工具栏可开关首选项、调整动效速度，觉得动画慢可以调快。',
      '不确定牌的效果时，悬停牌面同样能看到完整描述。',
    ],
  },
];

/** 收起态入口行：低调小按钮，融入大厅卡片 */
const entryRow = css`
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
`;

const entryBtn = css`
  background-color: ${colors.bg.input};
  color: ${colors.text.secondary};
  border: 1px solid rgba(241, 196, 15, 0.35);
  border-radius: 14px;
  padding: 4px 16px;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;

  &:hover {
    color: ${goldColors.light};
    border-color: ${goldColors.base};
  }
`;

/** 展开态面板：暗色底 + 金色节标题，与大厅卡片同语言 */
const panel = css`
  background-color: rgba(18, 24, 40, 0.6);
  border: 1px solid rgba(241, 196, 15, 0.28);
  border-radius: 10px;
  padding: 16px 18px;
  margin-bottom: 20px;
`;

const panelHeader = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;

const panelTitle = css`
  font-size: 15px;
  font-weight: bold;
  color: ${goldColors.light};
  letter-spacing: 2px;
`;

const closeBtn = css`
  background-color: transparent;
  color: ${colors.text.muted};
  border: none;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;

  &:hover {
    color: ${colors.text.primary};
  }
`;

/** 单节标题：左侧金色小竖条，呼应页面 sectionTitle */
const sectionHead = css`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: bold;
  color: ${goldColors.light};
  margin: 12px 0 6px;

  &::before {
    content: '';
    flex-shrink: 0;
    width: 3px;
    height: 13px;
    border-radius: 2px;
    background: linear-gradient(180deg, ${goldColors.base}, ${goldColors.deep});
  }
`;

/** 节内条目列表 */
const itemList = css`
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: ${colors.text.secondary};
`;

export function OnboardingGuide() {
  // 首次（localStorage 无标记）默认展开一次；之后默认收起。
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SHOWN_KEY) === null;
    } catch {
      // localStorage 不可用（隐私模式等）时默认收起，不影响使用
      return false;
    }
  });

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      // 关闭时写入「已看过」标记，下次进房默认收起
      if (!next) {
        try {
          localStorage.setItem(SHOWN_KEY, '1');
        } catch {
          // 写入失败静默忽略：仅影响下次是否再自动展开
        }
      }
      return next;
    });
  }, []);

  if (!open) {
    return (
      <div className={entryRow}>
        <button className={entryBtn} onClick={toggle}>
          ❔ 新手教程
        </button>
      </div>
    );
  }

  return (
    <div className={panel}>
      <div className={panelHeader}>
        <div className={panelTitle}>❔ 新手教程</div>
        <button className={closeBtn} onClick={toggle}>
          收起 ✕
        </button>
      </div>
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <div className={sectionHead}>
            {section.icon} {section.title}
          </div>
          <ul className={itemList}>
            {section.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
