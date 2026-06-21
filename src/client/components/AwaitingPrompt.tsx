// src/client/components/AwaitingPrompt.tsx
// 等待回应区:渲染 pending prompt 的回应面板(distribute / confirm / useCard 三分支)。
// 纯展示,所有数据与回调通过 props 传入。
import * as styles from './gameViewStyles';
import type { GameView, Card, Json, PendingView } from '../../engine/types';
import { DistributeUI } from './DistributeUI';
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
  /** view 相关(DistributeUI 需要) */
  view: GameView;
  perspectiveIdx: number;
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
    view,
    perspectiveIdx,
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
        // distribute 类 pending(遗计分配):渲染分配 UI
        if (pending.prompt.type === 'distribute') {
          const info = resolvePendingRespond(pending, skillActions);
          const skillId = info?.skillId ?? '系统规则';
          const cardIds = (pending.prompt as { cardIds?: string[] }).cardIds ?? [];
          return <DistributeUI skillId={skillId} actionType="respond" prompt={pending.prompt} cardIds={cardIds} players={view.players} viewer={perspectiveIdx} onSend={onSend} cardMap={view.cardMap} />;
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