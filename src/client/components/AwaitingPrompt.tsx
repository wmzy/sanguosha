// src/client/components/AwaitingPrompt.tsx
// 等待回应区:渲染 pending prompt 的回应面板(confirm / useCard 两分支)。
// distribute 类 pending(遗计分配)不在本组件渲染——由 GameView 统一分配面板处理(选牌在手牌区)。
// 纯展示,所有数据与回调通过 props 传入。
import * as styles from './gameViewStyles';
import type { Card, Json, PendingView } from '../../engine/types';
import { resolvePendingRespond } from '../utils/pendingRespond';
import type { SkillActionDef } from '../skillActionRegistry';

export interface AwaitingPromptProps {
  pending: PendingView;
  pendingTargetIdx: number;
  perspectiveName: string;
  perspectiveHand: Card[];
  skillActions: SkillActionDef[];
  skippedBroadcast: Set<string>;
  canOperate: boolean;
  /** 发送动作(无 preceding,本组件不涉及前置 action) */
  onSend: (skillId: string, actionType: string, params: Record<string, Json>) => void;
  /** 回应(不传 = 不回应;传 cardId = 打出该牌回应) */
  onRespond: (cardId?: string) => void;
}

export function AwaitingPrompt(props: AwaitingPromptProps) {
  const {
    pending,
    pendingTargetIdx,
    perspectiveName,
    perspectiveHand,
    skillActions,
    skippedBroadcast,
    canOperate,
    onSend,
    onRespond,
  } = props;

  // 广播型 pending 且已本地跳过:显示已跳过提示
  const isBroadcast = pendingTargetIdx < 0;
  const broadcastKey = `${pending.atom?.type}:${(pending.atom as { requestType?: string }).requestType}`;
  const isSkipped = isBroadcast && skippedBroadcast.has(broadcastKey);

  return (
    <div className={styles.promptBoxAwaiting}>
      <div className={styles.promptTitle}>⚡ 需要回应 — {perspectiveName}</div>
      <div className={styles.promptDesc}>
        {pending.prompt.title}
        {pending.prompt.description && <span> — {pending.prompt.description}</span>}
      </div>
      {isSkipped ? (
        <div className={styles.waitingHint}>已跳过，等待其他玩家回应...</div>
      ) : canOperate ? (() => {
        // pickHandIndex 类 pending(过河拆桥/顺手牵羊盲选手牌位置):
        // 渲染目标手牌的牌背序列,使用者点击位置选择
        if (pending.prompt.type === 'pickTargetCard') {
          const info = resolvePendingRespond(pending, skillActions);
          const skillId = info?.skillId ?? '系统规则';
          const p = pending.prompt;
          return (
            <div className={styles.promptActions} style={{ flexWrap: 'wrap', gap: '6px' }}>
              {/* 装备区明牌 */}
              {p.equipment.length > 0 && (
                <span className={styles.promptDesc} style={{ width: '100%', marginBottom: 0 }}>装备区:</span>
              )}
              {p.equipment.map(({ slot, cardId, cardName }) => (
                <button
                  key={cardId}
                  className={styles.promptBtn}
                  onClick={() => onSend(skillId, 'respond', { zone: 'equipment', cardId })}
                >{slot}:{cardName}</button>
              ))}
              {/* 判定区明牌 */}
              {p.judge.length > 0 && (
                <span className={styles.promptDesc} style={{ width: '100%', marginBottom: 0 }}>判定区:</span>
              )}
              {p.judge.map(({ cardId, cardName }) => (
                <button
                  key={cardId}
                  className={styles.promptBtn}
                  onClick={() => onSend(skillId, 'respond', { zone: 'judge', cardId })}
                >{cardName}</button>
              ))}
              {/* 手牌盲选 */}
              {p.handCount > 0 && (
                <>
                  <span className={styles.promptDesc} style={{ width: '100%', marginBottom: 0 }}>手牌（凭位置盲选）:</span>
                  {Array.from({ length: p.handCount }, (_, i) => (
                    <button
                      key={i}
                      className={styles.promptBtn}
                      style={{ minWidth: '40px' }}
                      onClick={() => onSend(skillId, 'respond', { zone: 'hand', handIndex: i })}
                    >{i + 1}</button>
                  ))}
                </>
              )}
            </div>
          );
        }
        // confirm 类 pending(反馈/遗计确认/八卦阵):渲染 发动/不发动 按钮
        if (pending.prompt.type === 'confirm') {
          const confirmLabel = pending.prompt.confirmLabel || '确认';
          const cancelLabel = pending.prompt.cancelLabel || '取消';
          const info = resolvePendingRespond(pending, skillActions);
          const skillId = info?.skillId ?? '系统规则';
          return (
            <div className={styles.promptActions}>
              <button className={styles.promptBtnPrimary} onClick={() => onSend(skillId, 'respond', { choice: true })}>{confirmLabel}</button>
              <button className={styles.promptBtn} onClick={() => onSend(skillId, 'respond', { choice: false })}>{cancelLabel}</button>
            </div>
          );
        }
        // useCard 类 pending:手牌区已对可回应的牌(杀/闪/桃/酒)高亮,直接在手牌区点击出牌。
        // 这里只显示文案提示 + 「不回应」按钮,不再单独列出候选牌。
        const info = resolvePendingRespond(pending, skillActions);
        const filterFn = info?.cardFilter;
        const respondableCount = filterFn ? perspectiveHand.filter(filterFn).length : 0;
        return (
          <div className={styles.promptActions}>
            <span className={styles.promptDesc} style={{ marginBottom: 0, alignSelf: 'center' }}>
              {respondableCount > 0
                ? `点击下方手牌区高亮的牌出牌回应（共 ${respondableCount} 张可选）`
                : '当前没有可出的牌回应'}
            </span>
            <button className={styles.promptBtn} onClick={() => onRespond()}>不回应</button>
          </div>
        );
      })() : (
        <div className={styles.waitingHint}>等待 {perspectiveName} 回应...</div>
      )}
    </div>
  );
}