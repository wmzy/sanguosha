// src/client/components/TargetSelector.tsx
// 目标选择面板(通用)。
//
// 根据 targetFilter 渲染:
//  - 有 slots:按槽位顺序渲染多个目标列表(B 槽位的 filter 接收 ctx.selected=[A] 等)。
//  - 无 slots:单目标列表(距离检查由父组件传入的 isTargetable 决定)。
//
// 纯展示,所有数据/回调由 props 传入。

import { cx } from '@linaria/core';
import type { Card, GameView, TargetFilter } from '../../engine/types';
import * as styles from './gameViewStyles';

export interface TargetSelectorProps {
  view: GameView;
  perspectiveIdx: number;
  /** 已选中的卡(取 .name 显示;转化模式下为 null,靠 transformWrapperName) */
  selectedCardId: string;
  perspectiveHand: Card[];
  /** 转化模式(武圣等);非 null 时点击目标走 onTransformPlay */
  transformMode: { wrapperName: string } | null;
  /** 选中卡的 use action targetFilter(父组件从 registry 派生)。
   *  转化模式下由父组件用 wrapperName 的 use action 提供。 */
  targetFilter: TargetFilter | null;
  /** 已选目标 name(单目标 = A;slots[0] = A,slots[1] 对应 selectedKillTarget) */
  selectedTarget: string | null;
  selectedKillTarget: string | null;
  /** 单目标距离检查(无 slots 时用) */
  isTargetable: (idx: number) => boolean;
  /** 单目标点击(切换选中) */
  onTargetClick: (name: string) => void;
  /** slots 模式:槽位选择(name, slotIdx) */
  onSlotSelect: (name: string, slotIdx: number) => void;
  /** 转化模式出牌(选完目标提交 preceding+主 action) */
  onTransformPlay: (targetName: string) => void;
}

export function TargetSelector(props: TargetSelectorProps) {
  const {
    view, perspectiveIdx, selectedCardId, perspectiveHand,
    transformMode, targetFilter, selectedTarget, selectedKillTarget,
    isTargetable, onTargetClick, onSlotSelect, onTransformPlay,
  } = props;

  const slots = targetFilter?.slots;
  // 已选座次数组(slots 模式下供 B 槽位 filter 求值):[A 的 idx]
  const selectedIdxArr: number[] = [];
  if (selectedTarget) {
    const aIdx = view.players.findIndex(p => p.name === selectedTarget);
    if (aIdx >= 0) selectedIdxArr.push(aIdx);
  }
  return (
    <div className={styles.targetSection}>
      {slots && slots.length > 1 ? (
        slots.map((slot, slotIdx) => {
          const isFirst = slotIdx === 0;
          const picked = isFirst ? selectedTarget : selectedKillTarget;
          // 首槽位选中后才渲染后续槽位(逐槽位选择)
          if (slotIdx > 0 && !selectedTarget) return null;
          // 已选座次上下文:首槽位 = [],B 槽位 = [A 的 idx]
          const ctxSelected = isFirst ? [] : selectedIdxArr;
          return (
            <div key={slotIdx}>
              <div className={styles.targetTitle} style={slotIdx > 0 ? { marginTop: 8 } : undefined}>
                {slotIdx === 0 ? '①' : '②'} 选 {slot.label}:
                {picked && <span className={styles.selectedTargetText}>{picked}</span>}
              </div>
              <div className={styles.targetList}>
                {view.players.map((p, i) => {
                  if (!p.alive || i === perspectiveIdx) return null;
                  // 后续槽位不能选已选过的座次(避免重复)
                  if (!isFirst && p.name === selectedTarget) return null;
                  const targetable = slot.filter ? slot.filter(view, i, { selected: ctxSelected }) : true;
                  return (
                    <button
                      key={i}
                      className={cx(styles.targetBtn, picked === p.name && styles.targetBtnActive, !targetable && styles.targetBtnDisabled)}
                      disabled={!targetable}
                      onClick={() => onSlotSelect(p.name, slotIdx)}
                    >
                      {p.name} ({p.character}) ♥{p.health}
                      {!targetable && <span className={styles.mutedHint}>距离外</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      ) : (
        <>
          <div className={styles.targetTitle}>选择目标:</div>
          <div className={styles.targetList}>
            {view.players.map((p, i) => {
              if (!p.alive || i === perspectiveIdx) return null;
              const targetable = isTargetable(i);
              return (
                <button
                  key={i}
                  className={cx(styles.targetBtn, selectedTarget === p.name && styles.targetBtnActive, !targetable && styles.targetBtnDisabled)}
                  disabled={!targetable}
                  onClick={() => transformMode ? onTransformPlay(p.name) : onTargetClick(p.name)}
                >
                  {p.name} ({p.character}) ♥{p.health}
                  {!targetable && <span className={styles.mutedHint}>距离外</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
