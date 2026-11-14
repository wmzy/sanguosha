// src/client/utils/HpFloatNumber.tsx
// 体力变化漂浮数字(座位卡/视角大卡共用):伤害「-N」红 / 回血「+N」绿,上浮渐隐 1s
// (动画状态由 useAnimationState 定时清除)。
// 样式为 gameViewStyles 的 hpFloat* 基座 + 尺寸变体(座位卡小号/大卡大号,
// 光晕强度经 --hp-float-glow 变量注入)。span 的 key 携带 version:
// 版本变化时重挂元素以重放 CSS 动画(原两处内联实现同 trick)。
import { cx } from '@linaria/core';
import * as styles from '../components/gameViewStyles';
import type { HpChangeNumber } from '../hooks/useAnimationState';

export interface HpFloatNumberProps {
  /** 刚发生的体力变化(动画期间存在) */
  hpChange: HpChangeNumber;
  /** 卡型变体:seat=弧形座位卡(小号),large=视角大卡(大号) */
  variant: 'seat' | 'large';
}

/** 体力变化漂浮数字。绝对定位于调用方的定位容器(座位卡包裹层/大卡内容层)。 */
export function HpFloatNumber({ hpChange, variant }: HpFloatNumberProps) {
  const sizeClass = variant === 'seat' ? styles.hpFloatNumberSeat : styles.hpFloatNumberLarge;
  return (
    <span
      key={`hpnum-${hpChange.version}`}
      className={cx(
        styles.hpFloatNumberBase,
        sizeClass,
        hpChange.kind === 'heal' ? styles.hpFloatHeal : styles.hpFloatDamage,
      )}
      aria-hidden
    >
      {hpChange.kind === 'heal' ? `+${hpChange.amount}` : `-${hpChange.amount}`}
    </span>
  );
}
