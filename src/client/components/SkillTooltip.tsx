// 技能 hover tooltip 组件与 hook。
//
// 问题:武将卡(playerCardLarge/seatCard)和装备区(leftPanel)的父容器
// 都有 overflow:hidden(圆角需要),CSS ::after 伪元素 tooltip 被裁剪不可见。
//
// 解法:用 createPortal 将 tooltip 渲染到 document.body,
// 完全绕过 overflow:hidden 容器。通过 getBoundingClientRect 定位。

import {
  useState,
  useRef,
  useCallback,
  type ElementType,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { css, cx } from '@linaria/core';

const tooltipBubble = css`
  position: fixed;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.95);
  color: #f0e6d3;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 300px;
  min-width: 140px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 215, 0, 0.2);
  pointer-events: none;
`;

const tooltipTitle = css`
  color: #ffd700;
  display: block;
  margin-bottom: 2px;
`;

const tagBase = css`
  cursor: help;
`;

/**
 * 给任意元素附加 hover tooltip。
 * 返回 onMouseEnter/onMouseLeave(展开到目标元素) + tooltip(放在 JSX 末尾)。
 * tooltip 通过 portal 渲染到 body,绕过 overflow:hidden。
 */
export function useHoverTooltip(
  content: string | undefined,
  title?: string,
): {
  onMouseEnter: (e: ReactMouseEvent) => void;
  onMouseLeave: () => void;
  tooltip: ReactNode;
} {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const targetRef = useRef<HTMLElement | null>(null);

  const handleEnter = useCallback(
    (e: ReactMouseEvent) => {
      if (!content) return;
      targetRef.current = e.currentTarget as HTMLElement;
      const rect = targetRef.current.getBoundingClientRect();
      setPos({ top: rect.top, left: rect.left, width: rect.width });
      setShow(true);
    },
    [content],
  );

  const handleLeave = useCallback(() => setShow(false), []);

  const tooltip =
    show && content
      ? createPortal(
          <div
            className={tooltipBubble}
            style={{
              top: pos.top - 8,
              left: pos.left + pos.width / 2,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {title && <strong className={tooltipTitle}>{title}</strong>}
            {content}
          </div>,
          document.body,
        )
      : null;

  return { onMouseEnter: handleEnter, onMouseLeave: handleLeave, tooltip };
}

/**
 * 简单技能标签:span/button + hover tooltip(自动)。
 * as="button" 时渲染为可点击按钮。
 */
export interface SkillTagProps {
  name: string;
  description?: string;
  as?: ElementType;
  className?: string;
  onClick?: (e: ReactMouseEvent) => void;
  children?: ReactNode;
}

export function SkillTag({
  name,
  description,
  as: As = 'span',
  className,
  onClick,
  children,
  ...rest
}: SkillTagProps) {
  const tip = useHoverTooltip(description, name);

  return (
    <>
      <As
        className={cx(tagBase, className)}
        onMouseEnter={tip.onMouseEnter}
        onMouseLeave={tip.onMouseLeave}
        onClick={onClick}
        {...rest}
      >
        {children ?? name}
      </As>
      {tip.tooltip}
    </>
  );
}
