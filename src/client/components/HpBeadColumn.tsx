// src/client/components/HpBeadColumn.tsx
// 右缘骑边体力珠列 —— 大卡(PlayerCardLarge)与座位卡(PlayerSeatView)共用的渲染组件:
// 损失体力(空珠)在上方,剩余体力(满珠)在下方,满珠按剩余比例三档分色。
// 缩放/分色公式此前在两组件内逐行镜像,现收敛为本文件的唯一实现。

import * as styles from './gameViewStyles';
import { hpBeadPalette, type HpBeadHue } from './gameViewStyles/tokens';

/** 体力珠尺寸指标(珠体宽/高与列内间距,均为 px 字符串,直接用于内联 style)。 */
export interface HpBeadMetrics {
  beadW: string;
  beadH: string;
  hpGap: string;
}

/** 珠体尺寸按 maxHealth 缩放:珠体基础 10×14px + 间距 3px,整列布局高度 = 17N−3(N=maxHealth);
 *  卡高 200px,仅 N ≥ 12(17×12−3=201>200)才会溢出卡面,此时按 6/N 等比缩小珠体与间距,
 *  使珠列完整排在卡右缘内;N ≤ 11 沿用基础尺寸(董卓 8 血/主公+1 后 9 血、标准 4 血无回归)。 */
export function hpBeadMetrics(maxHealth: number): HpBeadMetrics {
  const hpScale = maxHealth >= 12 ? 6 / maxHealth : 1;
  return {
    beadW: `${10 * hpScale}px`,
    beadH: `${14 * hpScale}px`,
    hpGap: `${3 * hpScale}px`,
  };
}

/** 满珠色档(与 data-hue 同判据):剩余体力比例 >50% 绿 / >25% 黄 / ≤25% 红(濒危警示)。 */
export function hpBeadHue(health: number, maxHealth: number): HpBeadHue {
  const hpRatio = maxHealth > 0 ? health / maxHealth : 1;
  return hpRatio > 0.5 ? 'green' : hpRatio > 0.25 ? 'yellow' : 'red';
}

export interface HpBeadColumnProps {
  /** 最大体力(珠总数;≥12 时触发珠体等比缩小) */
  maxHealth: number;
  /** 当前体力(决定空珠数与满珠分色档) */
  health: number;
  /** 列容器定位样式类(大卡 playerCardHpBeadCol / 座位卡 seatHpBeadCol,由调用方注入) */
  className: string;
}

/** 右缘体力珠列:垂直排列,骑在卡右边框上;空珠(已损失)在上,满珠在下按余量分色。
 *  满珠珠体为 gameViewStyles 的 playerCardHpBeadFull 单类,分色经 tokens.hpBeadPalette
 *  的 --bead-* 内联变量注入;空珠为 playerCardHpBeadEmpty。 */
export function HpBeadColumn({ maxHealth, health, className }: HpBeadColumnProps) {
  const { beadW, beadH, hpGap } = hpBeadMetrics(maxHealth);
  // 珠列方向:损失的体力(空珠)在上方,剩余体力(满珠)在下方。
  const lostCount = Math.max(0, maxHealth - health);
  const hue = hpBeadHue(health, maxHealth);
  const beadFullVars = hpBeadPalette[hue];
  return (
    <div className={className} style={{ gap: hpGap }} aria-hidden data-hp-beads>
      {Array.from({ length: maxHealth }, (_, i) => (
        <span
          key={i}
          className={i < lostCount ? styles.playerCardHpBeadEmpty : styles.playerCardHpBeadFull}
          data-full={i < lostCount ? undefined : 'true'}
          data-hue={i < lostCount ? undefined : hue}
          style={{ width: beadW, height: beadH, ...(i < lostCount ? undefined : beadFullVars) }}
        />
      ))}
    </div>
  );
}
