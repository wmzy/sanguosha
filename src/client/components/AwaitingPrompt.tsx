// src/client/components/AwaitingPrompt.tsx
// 等待回应区:渲染 pending prompt 的回应面板(confirm / useCard 两分支)。
// distribute 类 pending(遗计分配)不在本组件渲染——由 GameView 统一分配面板处理(选牌在手牌区)。
// 纯展示,所有数据与回调通过 props 传入。
// pendingRespondInfo 由 usePendingState memo 后从父组件传入,不再在此重复 resolve。
import * as styles from './gameViewStyles';
import type { Card, Json, PendingView } from '../../engine/types';
import type { PendingRespondInfo } from '../utils/pendingRespond';
import type { SkillActionDef } from '../skillActionRegistry';
import type { ProcessingPickState } from '../hooks/useProcessingPicks';

export interface AwaitingPromptProps {
  pending: PendingView;
  pendingTargetIdx: number;
  perspectiveName: string;
  perspectiveHand: Card[];
  /** 已 resolve 的 respond 信息(由 usePendingState memo 后传入) */
  pendingRespondInfo: PendingRespondInfo | null;
  /** 广播去重 key(由 usePendingState memo 后传入) */
  broadcastKey: string;
  /** skillActions 仅用于类型兼容旧调用点;respond 信息已在父组件 resolve */
  skillActions: SkillActionDef[];
  skippedBroadcast: Set<string>;
  canOperate: boolean;
  /** 五谷丰登选牌展示增强:被选走的牌标注选牌者并禁用 */
  processingPicks?: ProcessingPickState | null;
  /** 发送动作(无 preceding,本组件不涉及前置 action) */
  onSend: (skillId: string, actionType: string, params: Record<string, Json>) => void;
}

export function AwaitingPrompt(props: AwaitingPromptProps) {
  const {
    pending,
    pendingTargetIdx,
    perspectiveName,
    perspectiveHand,
    pendingRespondInfo,
    broadcastKey,
    skillActions: _skillActions,
    skippedBroadcast,
    canOperate,
    processingPicks,
    onSend,
  } = props;

  // 广播型 pending 且已本地跳过:显示已跳过提示
  const isBroadcast = pendingTargetIdx < 0;
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
      ) : canOperate ? (
        (() => {
          // respond 信息由 usePendingState memo 后传入,不再在此重复 resolve(原先每个分支调一次)。
          const skillId = pendingRespondInfo?.skillId ?? '系统规则';
          const filterFn = pendingRespondInfo?.cardFilter;
          // pickHandIndex 类 pending(过河拆桥/顺手牵羊盲选手牌位置):
          // 渲染目标手牌的牌背序列,使用者点击位置选择
          if (pending.prompt.type === 'pickTargetCard') {
            const p = pending.prompt;
            return (
              <div className={styles.promptActionsWrap}>
                {/* 装备区明牌 */}
                {p.equipment.length > 0 && <span className={styles.promptDescFull}>装备区:</span>}
                {p.equipment.map(({ slot, cardId, cardName }) => (
                  <button
                    key={cardId}
                    className={styles.promptBtn}
                    onClick={() => onSend(skillId, 'respond', { zone: 'equipment', cardId })}
                  >
                    {slot}:{cardName}
                  </button>
                ))}
                {/* 判定区明牌 */}
                {p.judge.length > 0 && <span className={styles.promptDescFull}>判定区:</span>}
                {p.judge.map(({ cardId, cardName }) => (
                  <button
                    key={cardId}
                    className={styles.promptBtn}
                    onClick={() => onSend(skillId, 'respond', { zone: 'judge', cardId })}
                  >
                    {cardName}
                  </button>
                ))}
                {/* 手牌盲选 */}
                {p.handCount > 0 && (
                  <>
                    <span className={styles.promptDescFull}>手牌（凭位置盲选）:</span>
                    {Array.from({ length: p.handCount }, (_, i) => (
                      <button
                        key={i}
                        className={styles.promptBtnMin}
                        onClick={() => onSend(skillId, 'respond', { zone: 'hand', handIndex: i })}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </>
                )}
              </div>
            );
          }
          // pickProcessingCard 类 pending(五谷丰登:从处理区亮的明牌选一张):
          // 渲染全量候选牌(含已被选走的),被选走的牌置暗禁用并标注选牌者。
          // processingPicks 由渲染层累积公开的「处理区→手牌」移动事件得到,不改引擎契约。
          if (pending.prompt.type === 'pickProcessingCard') {
            const p = pending.prompt;
            // 有累积状态时用全量候选(含已选牌),否则回退到 pending 原始 cards
            const cards = processingPicks?.allCards ?? p.cards;
            const pickedBy = processingPicks?.pickedBy;
            return (
              <div className={styles.promptActionsWrap}>
                {cards.length > 0 && <span className={styles.promptDescFull}>处理区可选牌:</span>}
                {cards.map(({ cardId, cardName, suit, rank }) => {
                  const picker = pickedBy?.get(cardId);
                  const isPicked = !!picker;
                  return (
                    <button
                      key={cardId}
                      className={isPicked ? styles.promptBtnDisabled : styles.promptBtn}
                      disabled={isPicked}
                      onClick={() => !isPicked && onSend(skillId, 'respond', { cardId })}
                    >
                      {cardName} {suit}
                      {rank}
                      {isPicked && <span className={styles.pickedByTag}>已被{picker}选走</span>}
                    </button>
                  );
                })}
              </div>
            );
          }
          // confirm 类 pending(反馈/遗计确认/八卦阵):渲染 发动/不发动 按钮
          if (pending.prompt.type === 'confirm') {
            const confirmLabel = pending.prompt.confirmLabel || '确认';
            const cancelLabel = pending.prompt.cancelLabel || '取消';
            return (
              <div className={styles.promptActions}>
                <button
                  className={styles.promptBtnPrimary}
                  onClick={() => onSend(skillId, 'respond', { choice: true })}
                >
                  {confirmLabel}
                </button>
                <button
                  className={styles.promptBtn}
                  onClick={() => onSend(skillId, 'respond', { choice: false })}
                >
                  {cancelLabel}
                </button>
              </div>
            );
          }
          // useCard 类 pending:手牌区已对可回应的牌(杀/闪/桃/酒)高亮,直接在手牌区点击出牌。
          // 「不回应」按钮已移至下方统一操作区(actionBar),此处仅显示文案提示。
          const respondableCount = filterFn ? perspectiveHand.filter(filterFn).length : 0;
          return (
            <div className={styles.promptActions}>
              <span className={styles.promptDescInline}>
                {respondableCount > 0
                  ? `点击下方手牌区高亮的牌出牌回应（共 ${respondableCount} 张可选），或点「不回应」跳过`
                  : '当前没有可出的牌回应，点「不回应」跳过'}
              </span>
            </div>
          );
        })()
      ) : (
        <div className={styles.waitingHint}>等待 {perspectiveName} 回应...</div>
      )}
    </div>
  );
}
