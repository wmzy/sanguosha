// src/client/components/AwaitingPrompt.tsx
// 等待回应区:渲染 pending prompt 的回应面板(confirm / useCard / choosePlayer 三分支)。
// distribute 类 pending(遗计分配)不在本组件渲染——由 GameView 统一分配面板处理(选牌在手牌区)。
// 纯展示,所有数据与回调通过 props 传入。
// 共享数据(view/perspectiveName/canOperate/send)来自 GameViewCtx,专属数据仍走 props
// (原 skillActions/onSend props 已删除:前者本就未使用,后者由 ctx.send 取代)。
// pendingRespondInfo 由 usePendingState memo 后从父组件传入,不再在此重复 resolve。
import { useState, useEffect } from 'react';
import * as styles from './gameViewStyles';
import type { Card, Faction, PendingView } from '../../engine/types';
import type { PendingRespondInfo } from '../utils/pendingRespond';
import type { ProcessingPickState } from '../hooks/useProcessingPicks';
import type { AutoSkipPrefs } from '../utils/autoSkip';
import { getPendingRequestType } from '../utils/pendingRespond';
import { FACTION_BG } from './gameViewConstants';
import { displaySkillName } from '../utils/skillDisplay';
import { CardBack } from './CardBack';
import { useGameView } from './GameViewCtx';

export interface AwaitingPromptProps {
  pending: PendingView;
  pendingTargetIdx: number;
  perspectiveHand: Card[];
  /** 已 resolve 的 respond 信息(由 usePendingState memo 后传入) */
  pendingRespondInfo: PendingRespondInfo | null;
  /** 广播去重 key(由 usePendingState memo 后传入) */
  broadcastKey: string;
  skippedBroadcast: Set<string>;
  /** 五谷丰登选牌展示增强:被选走的牌标注选牌者并禁用 */
  processingPicks?: ProcessingPickState | null;
  /** 自动跳过用户偏好(策略跳过开关状态) */
  autoSkipPrefs?: AutoSkipPrefs;
  /** 切换策略跳过开关(requestType) */
  onToggleAutoSkip?: (requestType: string) => void;
}

export function AwaitingPrompt(props: AwaitingPromptProps) {
  // 共享数据来自 GameViewCtx(view/canOperate/perspectiveName/send)
  const { view, canOperate, perspectiveName, send } = useGameView();
  const {
    pending,
    pendingTargetIdx,
    perspectiveHand,
    pendingRespondInfo,
    broadcastKey,
    skippedBroadcast,
    processingPicks,
    autoSkipPrefs,
    onToggleAutoSkip,
  } = props;

  // 广播型 pending 且已本地跳过:显示已跳过提示
  const isBroadcast = pendingTargetIdx < 0;
  const isSkipped = isBroadcast && skippedBroadcast.has(broadcastKey);

  // choosePlayer 多选累积状态(pending 变化时重置)
  const [multiSelect, setMultiSelect] = useState<number[]>([]);
  useEffect(() => {
    setMultiSelect([]);
  }, [pending]);

  // ── 无懈可击 prompt 上下文文案 ──
  // 引擎构造的 prompt.title 是固定「是否打出无懈可击?」;前端补充
  // 「抵消 <对 P_n 的 锦囊名>」,让玩家清楚抵消的是谁的什么牌。
  // cancelTarget 来自 atom(广播型 请求回应 requestType='无懈可击');
  // 锦囊名从处理区查 card.name;名取自 view.players[cancelTarget].name。
  const wuxieHint = (() => {
    const atom = pending.atom as { type?: string; requestType?: string; cancelTarget?: number };
    if (atom.type !== '请求回应' || atom.requestType !== '无懈可击') return undefined;
    const cancelTarget = atom.cancelTarget;
    if (typeof cancelTarget !== 'number' || cancelTarget < 0) return undefined;
    const targetName = view.players.find((p) => p.index === cancelTarget)?.name ?? `P${cancelTarget}`;
    // 处理区锦囊名(排除闪等响牌):取第一张非闪、非杀、非无懈可击的牌当作锦囊。
    const procIds = view.zones?.processing ?? [];
    const candidate = procIds
      .map((id) => view.cardMap[id])
      .filter((c): c is Card => !!c)
      .find((c) => c.name !== '闪' && c.name !== '杀' && c.name !== '无懈可击');
    const trickName = candidate?.name ?? '锦囊';
    return `抵消 对 ${targetName} 的 ${trickName}`;
  })();

  return (
    <div className={styles.promptBoxAwaiting}>
      <div className={styles.promptTitle}>⚡ 需要回应 — {perspectiveName}</div>
      <div className={styles.promptDesc}>
        {pending.prompt.title}
        {wuxieHint && <span> — {wuxieHint}</span>}
        {!wuxieHint && pending.prompt.description && (
          <span> — {pending.prompt.description}</span>
        )}
      </div>
      {/* 自动跳过此类开关:仅可操作 + 有 requestType 时显示 */}
      {canOperate && onToggleAutoSkip && (() => {
        const reqType = getPendingRequestType(pending);
        if (!reqType) return null;
        const checked = !!autoSkipPrefs?.optInSkip[reqType];
        return (
          <label className={styles.autoSkipToggle}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggleAutoSkip(reqType)}
            />
            <span>以后自动跳过此类询问</span>
          </label>
        );
      })()}
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
                    onClick={() => send(skillId, 'respond', { zone: 'equipment', cardId })}
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
                    onClick={() => send(skillId, 'respond', { zone: 'judge', cardId })}
                  >
                    {cardName}
                  </button>
                ))}
                {/* 手牌盲选:渲染目标手牌的牌背序列,使用者点击位置选择(序号作角标) */}
                {p.handCount > 0 && (
                  <>
                    <span className={styles.promptDescFull}>手牌（凭位置盲选）:</span>
                    <div className={styles.pickHandRow}>
                      {Array.from({ length: p.handCount }, (_, i) => (
                        <button
                          key={i}
                          className={styles.pickHandCard}
                          onClick={() => send(skillId, 'respond', { zone: 'hand', handIndex: i })}
                          title={`第 ${i + 1} 张`}
                        >
                          <CardBack />
                          <span className={styles.pickHandIndex}>{i + 1}</span>
                        </button>
                      ))}
                    </div>
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
                      onClick={() => !isPicked && send(skillId, 'respond', { cardId })}
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
          // confirm 类 pending(反馈/遗计确认/八卦阵/界狂骨二选一):渲染 发动/不发动 按钮
          if (pending.prompt.type === 'confirm') {
            const confirmLabel = pending.prompt.confirmLabel ?? '确认';
            const cancelLabel = pending.prompt.cancelLabel ?? '取消';
            const confirmDisabled = pending.prompt.confirmDisabled === true;
            return (
              <div className={styles.promptActions}>
                <button
                  className={confirmDisabled ? styles.promptBtnDisabled : styles.promptBtnPrimary}
                  disabled={confirmDisabled}
                  onClick={() => !confirmDisabled && send(skillId, 'respond', { choice: true })}
                >
                  {confirmLabel}
                </button>
                <button
                  className={styles.promptBtn}
                  onClick={() => send(skillId, 'respond', { choice: false })}
                >
                  {cancelLabel}
                </button>
              </div>
            );
          }
          // chooseOption 类 pending(化身:从多个选项中选一个)
          if (pending.prompt.type === 'chooseOption') {
            const p = pending.prompt;
            const characterCards = p.characterCards;
            return (
              <div className={styles.promptActionsWrap}>
                {characterCards
                  ? // 武将牌面板:每张武将牌显示势力色底+武将名+技能列表
                    p.options.map((opt) => {
                      const cardData = characterCards[opt.value];
                      const faction: Faction = cardData?.faction ?? '群';
                      const factionColor = FACTION_BG[faction] || '#8e44ad';
                      return (
                        <button
                          key={opt.value}
                          className={styles.chooseOptionCard}
                          style={{
                            background: `${factionColor  }20`,
                            borderColor: factionColor,
                          }}
                          onClick={() => send(skillId, 'respond', { option: opt.value })}
                        >
                          <span className={styles.chooseOptionCardName}>
                            {opt.label}
                          </span>
                          {cardData && (
                            <span className={styles.chooseOptionCardSkills}>
                              {cardData.skills.map(displaySkillName).join(' · ')}
                            </span>
                          )}
                        </button>
                      );
                    })
                  : // 普通选项按钮
                    p.options.map((opt) => (
                      <button
                        key={opt.value}
                        className={styles.promptBtnPrimary}
                        onClick={() => send(skillId, 'respond', { option: opt.value })}
                      >
                        {opt.label}
                      </button>
                    ))}
              </div>
            );
          }
          // choosePlayer 类 pending(流离/奋威/突袭/激将 等):渲染候选目标按钮。
          // 单选(max===1)点击即发;多选(max>1)累积后确认。candidates 由引擎投影层注入。
          // 同时发 target(首个)与 targets(数组)以兼容各技能 respond 的 param 读取契约。
          if (pending.prompt.type === 'choosePlayer') {
            const p = pending.prompt;
            const candidates = p.candidates ?? [];
            const names = view.players;
            const max = p.max ?? 1;
            const min = p.min ?? 1;
            if (max <= 1) {
              return (
                <div className={styles.promptActionsWrap}>
                  {candidates.length === 0 && (
                    <span className={styles.promptDescInline}>无可选目标</span>
                  )}
                  {candidates.map((t) => (
                    <button
                      key={t}
                      className={styles.promptBtn}
                      onClick={() => send(skillId, 'respond', { target: t, targets: [t] })}
                    >
                      {names[t]?.name ?? `P${t}`}
                    </button>
                  ))}
                  {min === 0 && (
                    <button
                      className={styles.promptBtn}
                      onClick={() => send(skillId, 'respond', { targets: [] })}
                    >
                      不选择
                    </button>
                  )}
                </div>
              );
            }
            const toggle = (t: number) =>
              setMultiSelect((prev) =>
                prev.includes(t)
                  ? prev.filter((x) => x !== t)
                  : prev.length < max
                    ? [...prev, t]
                    : prev,
              );
            const canConfirm = multiSelect.length >= min && multiSelect.length <= max;
            return (
              <div className={styles.promptActionsWrap}>
                {candidates.length === 0 && (
                  <span className={styles.promptDescInline}>无可选目标</span>
                )}
                {candidates.map((t) => {
                  const selected = multiSelect.includes(t);
                  return (
                    <button
                      key={t}
                      className={selected ? styles.promptBtnPrimary : styles.promptBtn}
                      onClick={() => toggle(t)}
                    >
                      {names[t]?.name ?? `P${t}`}
                    </button>
                  );
                })}
                <button
                  className={canConfirm ? styles.promptBtnPrimary : styles.promptBtnDisabled}
                  disabled={!canConfirm}
                  onClick={() => canConfirm && send(skillId, 'respond', { targets: multiSelect })}
                >
                  确认({multiSelect.length}/{max})
                </button>
                {min === 0 && (
                  <button
                    className={styles.promptBtn}
                    onClick={() => send(skillId, 'respond', { targets: [] })}
                  >
                    不选择
                  </button>
                )}
              </div>
            );
          }
          // useCard / useCardAndTarget 类 pending:手牌区对可回应的牌(杀/闪/桃/酒)高亮。改为「先选牌再点打出」两步式
          // (避免误触直接出牌),出牌/不回应按钮在下方统一操作区(actionBar),此处仅显示文案提示。
          // useCardAndTarget(借刀杀人/出杀)还需选目标座次,提示文案区分。
          const respondableCount = filterFn ? perspectiveHand.filter(filterFn).length : 0;
          const needsTarget = pending.prompt.type === 'useCardAndTarget';
          return (
            <div className={styles.promptActions}>
              <span className={styles.promptDescInline}>
                {respondableCount > 0
                  ? needsTarget
                    ? `选择高亮的牌（共 ${respondableCount} 张可选），再选目标，点「打出」确认；或点「交出武器」跳过`
                    : `选择高亮的牌（共 ${respondableCount} 张可选），再点「打出」确认，或点「不回应」跳过`
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
