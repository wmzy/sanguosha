// 简单技能标签组件:span/button + hover tooltip(自动)。
// tooltip 实现见 useHoverTooltip hook(已提取到独立文件)。

import { type ElementType, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { css, cx } from '@linaria/core';
import { useHoverTooltip } from '../hooks/useHoverTooltip';

const tagBase = css`
  cursor: help;
`;

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
  /** as="button" 时的禁用态(置灰按钮,不触发点击);其余元素忽略。
   *  注意:原生 disabled 元素不触发 mouseenter,自绘 tooltip 失效,原因提示走原生 title。 */
  disabled?: boolean;
  /** 透传到元素的原生 title 属性(disabled 元素上原生 tooltip 仍显示)。 */
  title?: string;
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
