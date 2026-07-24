// src/client/components/GameView.tsx
// 完整游戏界面主组件。
//
// 职责:编排子组件 + 转发 hook 产出的状态/handler 到对应展示组件。
// 展示逻辑全部委托给子组件(GameHeader/OverlaysLayer/AwaitingPrompt/PlayPhasePrompt/
// SeatArcLayout/ZoneInfoBar/HandCard/PlayerCardLarge)。
// 状态派生委托给 hooks(useSkillActions/usePendingState/useCharSelect/useSeatOrder/
// useAnimationState/useHandReorder/usePlayInteraction)。
//
// 不感知视角切换:本组件只渲染 view.viewer 这一个视角的游戏画面。
//   正式模式:上层直接传入 view,viewer 就是当前玩家。
//   debug 模式:上层(DebugLobby)管理多连接 + 视角切换,把当前视角连接的 view 传入,
//   并通过 headerSlot/overlaySlot 注入视角控制 UI。切换视图、自动跟随、代打等逻辑
//   均在上层,本组件不可见。
//
// 布局: GameHeader → [Battlefield: SeatRing + CenterTable | SideDock] → BottomBar(装备|手牌|武将)
import { useState, useCallback, useRef, memo, type ReactNode } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView as EngineGameView, Card, Json } from '../../engine/types';
import { getAtomDef } from '../../engine/atom';
import { CountdownBar, DEFAULT_COUNTDOWN_TOTAL_MS } from './CountdownBar';
import { PlayerCardLarge } from './PlayerCardLarge';
import { EventBanner } from './EventBanner';
import { ActionOverlay } from './ActionOverlay';
import { DevProfiler } from './DevProfiler';

// ─── 抽取的子组件 ───
import { GameHeader } from './GameHeader';
import { OverlaysLayer } from './OverlaysLayer';
import { AwaitingPrompt } from './AwaitingPrompt';
import { PlayPhasePrompt } from './PlayPhasePrompt';
import { SeatArcLayout } from './SeatArcLayout';
import { ZoneInfoBar } from './ZoneInfoBar';
import { HandCard } from './HandCard';
import { CancelButton } from './CancelButton';
import { EquipColumn } from './EquipColumn';
import { InfoDock } from './InfoDock';
import { PlayHistoryStrip } from './PlayHistoryStrip';
import {
  canShowCancelSelectionButton,
  canShowEndTurnButton,
  findUseActionForCard,
  isActiveAction,
} from '../utils/gameViewHelpers';
import { SUIT_COLOR } from './gameViewConstants';

// ─── 抽取的 hooks ───
import { useAnimationState } from '../hooks/useAnimationState';
import { useCardMoveAnimation } from '../hooks/useCardMoveAnimation';
import { useSkillActions } from '../hooks/useSkillActions';
import { usePendingState } from '../hooks/usePendingState';
import { useCharSelect } from '../hooks/useCharSelect';
import { useSeatOrder } from '../hooks/useSeatOrder';
import { useHandReorder } from '../hooks/useHandReorder';
import { usePlayInteraction } from '../hooks/usePlayInteraction';
import { useProcessingPicks } from '../hooks/useProcessingPicks';
import { usePlayHistory } from '../hooks/usePlayHistory';

import type { QueuedEvent } from '../hooks/useEventPlayback';

import type { ActionMsg } from '../types';

interface Props {
  view: EngineGameView;
  onAction: (action: ActionMsg) => void;
  /** 整理手牌:重排顺序(不走 action,直接 mutate 后端 hand) */
  onReorderHand?: (order: string[]) => void;
  /** 双击其他座次卡片(通用 UI 事件;上层决定行为,如切换视角)。 */
  onSeatDoubleClick?: (index: number) => void;
  /** 顶部栏右侧插槽:上层渲染视角控制/退出等 debug UI。不提供则右侧为空。 */
  headerSlot?: ReactNode;
  /** 遮罩角落插槽:上层在选将/等待遮罩内渲染视角控制 UI。 */
  overlaySlot?: ReactNode;
  /** 当前播放的事件(来自 useEventPlayback),用于 GameView 内部事件横幅展示。
   *  正式模式可不传(无事件播放队列)。 */
  currentEvent?: QueuedEvent | null;
  /** 刚入队的事件批次:出牌历史在「使用时」立即入条,不等播放队列延时。 */
  ingestedEvents?: QueuedEvent[];
  /** 只读模式(回放):禁用选将/身份揭示等阻塞性遮罩,避免遮挡游戏画面。
   *  正式/debug 模式不传(默认 false),保持原有选将流程。 */
  readOnly?: boolean;
  /** 聊天消息(可选)。传入后会在右下角 InfoDock 多 tab 浮窗显示「聊天」tab。
   *  不传 → InfoDock 仅显示「日志」tab。DebugLobby 不传。 */
  chatMessages?: import('../headless/types').ChatMessage[];
  /** 聊天配置(可选)。 */
  chatConfig?: import('../../server/protocol').ChatConfig;
  /** 发送聊天(可选)。 */
  onSendChat?: (text: string) => void;
}

// ─── 主组件 ───
// 纯净的单视角组件:只渲染 view.viewer 的游戏画面,不感知视角切换。
//   正式模式:上层直接传入当前玩家的 view。
//   debug 模式:上层(DebugLobby)管理多连接和视角切换,把当前视角连接的 view 传入,
//   并通过 headerSlot/overlaySlot 注入视角控制 UI。
export function GameViewComponentImpl({
  view,
  onAction,
  onReorderHand,
  onSeatDoubleClick,
  headerSlot,
  overlaySlot,
  currentEvent,
  ingestedEvents,
  readOnly = false,
  chatMessages,
  chatConfig,
  onSendChat,
}: Props) {
  // perspectiveIdx 必须是有效座次索引。旁观者(无授权 viewer=-1)或越界时回退到座次 0,
  // 避免 view.players[perspectiveIdx] 为 undefined 导致渲染崩溃。
  // 旁观者看不到任何手牌(buildView 按原始 viewer=-1 过滤 hand),仅借用座次 0 做展示视角。
  const perspectiveIdx =
    view.viewer >= 0 && view.viewer < view.players.length ? view.viewer : 0;
  const [showIdentityReveal, setShowIdentityReveal] = useState(
    () => !sessionStorage.getItem('sgs_identity_shown'),
  );

  // view ref:供 stabilized callback 访问最新 view,避免 view.cardMap 进入 useCallback deps
  const viewRef = useRef(view);
  viewRef.current = view;

  // ─── 状态派生(hooks) ───
  const { skillActions } = useSkillActions(view, perspectiveIdx);
  const pendingState = usePendingState(view, perspectiveIdx, skillActions);
  const {
    pending,
    pendingTargetIdx,
    isPerspectiveAwaiting,
    isDiscardPhase,
    discardMin,
    discardMax,
    skippedBroadcast,
    markBroadcastSkipped,
    deadline,
    deadlineTotalMs,
    pendingRespondInfo,
    broadcastKey,
  } = pendingState;
  const { isCharSelectPending, charSelect, charSelectInProgress } = useCharSelect(
    view,
    perspectiveIdx,
  );
  const orderedPlayers = useSeatOrder(view, perspectiveIdx);
  const anim = useAnimationState(view, perspectiveIdx);
  useCardMoveAnimation(ingestedEvents ?? [], view);
  const playHistoryItems = usePlayHistory(ingestedEvents, view);

  const handListRef = useRef<HTMLDivElement>(null);

  const perspectivePlayer = view.players[perspectiveIdx];
  const perspectiveName = perspectivePlayer.name ?? `P${perspectiveIdx}`;
  const isPerspectiveTurn = view.currentPlayerIndex === perspectiveIdx;
  const isMyTurn = isPerspectiveTurn;
  const currentPlayer = view.players[view.currentPlayerIndex];
  const currentPlayerName = currentPlayer.name;
  const perspectiveHand: Card[] = perspectivePlayer.hand ?? [];

  // 手牌拖拽重排(已抽出到 useHandReorder)
  const { orderedHand, handleDragStart, handleDrop } = useHandReorder(
    perspectiveHand,
    onReorderHand,
  );

  // 回放(只读)模式下禁用一切游戏操作:出牌/技能/弃牌/分配/结束回合等
  // 按钮均通过 canOperate 传导自动隐藏或 disabled。
  const canOperate = !readOnly;

  // 发送 action(出牌交互状态机共享的底层函数)
  const send = useCallback(
    (
      skillId: string,
      actionType: string,
      params: Record<string, Json>,
      preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>,
    ) => {
      onAction({ skillId, actionType, ownerId: perspectiveIdx, params, preceding });
    },
    [onAction, perspectiveIdx],
  );

  // ─── 出牌交互状态机(已抽出到 usePlayInteraction) ───
  // 五谷丰登选牌展示增强:通过对 view 快照的 diff 推导被选走的牌,标注选牌者
  const processingPicks = useProcessingPicks(view);

  const play = usePlayInteraction(isMyTurn, canOperate, {
    view,
    perspectiveIdx,
    perspectiveHand,
    skillActions,
    pending,
    isDiscardPhase,
    discardMin,
    discardMax,
    isPerspectiveAwaiting,
    pendingRespondInfo,
    broadcastKey,
    markBroadcastSkipped,
    pendingTargetIdx,
    send,
    handListRef,
  });
  const {
    selectedCardId,
    selectedTarget,
    selectedKillTarget,
    selectedMultiTargets,
    selectedForDiscard,
    transformMode,
    distributeMode,
    activeDistribute,
    isDistributeActive,
    distSelected,
    distAllocations,
    distTargetName,
    distExternalCandidates,
    selectedActive,
    playButtonState,
    altActions,
    playRules,
    handleCardClick,
    handlePlayCard,
    handleTargetClick,
    handleSkillAction,
    handleTransformPlay,
    handleRespond,
    handleEndTurn,
    handleConfirmDiscard,
    isTargetable,
    handleDistSubmit,
    handleDistClear,
    cancelTransform,
    cancelSelection,
    clearDiscard,
    setDistributeMode,
  } = play;

  const isMyAwaiting = isPerspectiveAwaiting && canOperate;
  // 广播型 pending(无懈可击等)当前视角已点「不回应」:本地标记跳过,
  // 隐藏自己的倒计时和「不回应」按钮(广播型 pending 仍在,其他座次照常显示)。
  const broadcastSkipped = pendingTargetIdx < 0 && skippedBroadcast.has(broadcastKey);

  // ─── stabilized callbacks（引用稳定，避免子组件 memo 失效） ───
  // 身份确认:无依赖,引用永远稳定
  const handleIdentityConfirm = useCallback(() => {
    setShowIdentityReveal(false);
    sessionStorage.setItem('sgs_identity_shown', '1');
  }, []);
  // 装备区点击 distribute 候选:用 viewRef 访问最新 cardMap,
  // 仅依赖 handleCardClick（状态变化时才变），不依赖 view.cardMap
  const handleEquipCardClick = useCallback(
    (cardId: string) => {
      const card = viewRef.current.cardMap[cardId];
      if (card) handleCardClick(card);
    },
    [handleCardClick],
  );

  // 判定翻牌动画(effect.animation='flip', blockUntilDone)期间,延迟询问类 pending 渲染。
  // 否则玩家会在判定结果(八卦阵/乐不思蜀等翻牌)还没看清时就被弹出「是否出闪」打断。
  // useEventPlayback 是非阻塞调度,这里据此实现 blockUntilDone 语义:翻牌动画播放完才显示 pending。
  const isPlayingFlipAnim =
    !!currentEvent &&
    (() => {
      const t =
        (currentEvent.event as { atomType?: string; type?: string }).atomType ??
        currentEvent.event.type;
      try {
        return getAtomDef(t)?.effect?.animation === 'flip';
      } catch {
        return false;
      }
    })();

  const showEndTurn = canShowEndTurnButton({
    canOperate,
    isMyTurn,
    phase: view.phase,
    pending,
  });
  const showCancelSelection = canShowCancelSelectionButton({
    selectedCardId,
    isMyTurn,
    phase: view.phase,
    pending,
  });
  const showCenterActionBar =
    (isMyAwaiting && !isDiscardPhase && pending?.prompt?.type === 'useCard' && !broadcastSkipped) ||
    (canOperate && !!selectedActive && !!transformMode) ||
    (canOperate && !!selectedActive && !transformMode && !!selectedCardId && !!playButtonState) ||
    (canOperate && !transformMode && !!selectedCardId && altActions.length > 0) ||
    showEndTurn ||
    (canOperate && isDiscardPhase && isPerspectiveAwaiting) ||
    (canOperate && isDistributeActive && !!activeDistribute) ||
    (!!selectedCardId && !!selectedTarget && canOperate && isMyTurn);

  // 底栏自己的大卡是否可作为目标（铁索连环含自己）。与 SeatArcLayout 的
  // selectedNeedsTarget 同源：选目标阶段 + 自己可被选（allowSelf/selfTarget）。
  const selfInTargetMode =
    (!!playRules && playRules.needsTarget) ||
    (isDistributeActive && !!activeDistribute?.externalTargetSelection);
  const selfTargetable = canOperate && selfInTargetMode && isTargetable(perspectiveIdx);
  const selfSelectedAsTarget =
    isDistributeActive && activeDistribute?.externalTargetSelection
      ? distTargetName === perspectiveName
      : playRules?.multiTarget
        ? selectedMultiTargets.includes(perspectiveName)
        : selectedTarget === perspectiveName;

  return (
    <div className={styles.pageRoot}>
      <OverlaysLayer
        view={view}
        perspectiveIdx={perspectiveIdx}
        isCharSelectPending={isCharSelectPending}
        charSelect={charSelect}
        charSelectInProgress={charSelectInProgress}
        showIdentityReveal={showIdentityReveal}
        onIdentityConfirm={handleIdentityConfirm}
        onAction={onAction}
        overlaySlot={overlaySlot}
        readOnly={readOnly}
      />

      <DevProfiler id="GameHeader">
        <GameHeader
          view={view}
          animTurnVersion={anim.turnVersion}
          animPhaseVersion={anim.phaseVersion}
          currentPlayerName={currentPlayerName}
          headerSlot={headerSlot}
        />
      </DevProfiler>

      {/* ─── 主内容:战场区 + 右侧边栏 ─── */}
      <div className={styles.mainContent}>
        <div className={styles.battleField}>
          {/* ─── 事件横幅(延时展示,非阻塞) ─── */}
          <EventBanner current={currentEvent ?? null} view={view} />
          {/* ─── 动作浮层+箭头(谁对谁用什么牌) ─── */}
          <ActionOverlay current={currentEvent ?? null} view={view} />

          {/* ─── 座位环 + 中央牌堆 + 底部操作坞 ─── */}
          <div className={styles.seatingArea}>
            <DevProfiler id="SeatArcLayout">
              <SeatArcLayout
                view={view}
                orderedPlayers={orderedPlayers}
                perspectiveName={perspectiveName}
                currentPlayerName={currentPlayerName}
                selectedNeedsTarget={
                  (!!playRules && playRules.needsTarget) ||
                  (isDistributeActive && !!activeDistribute?.externalTargetSelection)
                }
                selectedTargetNames={
                  isDistributeActive && activeDistribute?.externalTargetSelection
                    ? distTargetName
                      ? [distTargetName]
                      : []
                    : playRules?.hasSlots
                      ? [selectedTarget, selectedKillTarget].filter((n): n is string => !!n)
                      : playRules?.multiTarget
                        ? selectedMultiTargets
                        : selectedTarget
                          ? [selectedTarget]
                          : []
                }
                isTargetable={isTargetable}
                onTargetClick={handleTargetClick}
                onSeatDoubleClick={onSeatDoubleClick}
                damageFlashIndices={anim.damageFlashIndices}
                turnVersion={anim.turnVersion}
                bottomSlot={
                  <>
                    {isPerspectiveAwaiting &&
                      pending &&
                      !isDiscardPhase &&
                      !isPlayingFlipAnim &&
                      pending?.atom?.type !== '选将询问' &&
                      pending.prompt.type !== 'distribute' && (
                        <AwaitingPrompt
                          pending={pending}
                          pendingTargetIdx={pendingTargetIdx}
                          perspectiveName={perspectiveName}
                          perspectiveHand={perspectiveHand}
                          pendingRespondInfo={pendingRespondInfo}
                          broadcastKey={broadcastKey}
                          skillActions={skillActions}
                          skippedBroadcast={skippedBroadcast}
                          canOperate={canOperate}
                          processingPicks={processingPicks}
                          onSend={send}
                          view={view}
                        />
                      )}
                    <PlayPhasePrompt
                      view={view}
                      perspectiveName={perspectiveName}
                      currentPlayerName={currentPlayerName}
                      perspectiveIdx={perspectiveIdx}
                      perspectiveHand={perspectiveHand}
                      isPerspectiveTurn={isPerspectiveTurn}
                      isPerspectiveAwaiting={isPerspectiveAwaiting}
                      isDiscardPhase={isDiscardPhase}
                      isMyTurn={isMyTurn}
                      canOperate={canOperate}
                      selectedCardId={selectedCardId}
                      selectedTarget={selectedTarget}
                      discardMin={discardMin}
                      discardMax={discardMax}
                      selectedForDiscard={selectedForDiscard}
                    />

                    {(isPerspectiveAwaiting || (isMyTurn && view.phase === '出牌')) &&
                      !broadcastSkipped &&
                      !readOnly && (
                        <CountdownBar
                          deadline={deadline}
                          totalMs={deadlineTotalMs || DEFAULT_COUNTDOWN_TOTAL_MS}
                        />
                      )}

                    {(transformMode || showCancelSelection) && (
                      <div className={styles.handHeader}>
                        {transformMode && (
                          <span className={cx(styles.debugHint, styles.transformHint)}>
                            ⚡ 转化模式:选
                            {transformMode.minCards > 1 ? `${transformMode.minCards}张` : '1张'}
                            {transformMode.wrapperName}
                            {transformMode.minCards > 1
                              ? `(${transformMode.selectedCardIds.length}/${transformMode.maxCards})`
                              : ''}{' '}
                            · 源技能 {transformMode.skillId}
                          </span>
                        )}
                        {transformMode && (
                          <CancelButton label="取消转化" onClick={cancelTransform} />
                        )}
                        {!transformMode && showCancelSelection && (
                          <CancelButton label="取消选择" onClick={cancelSelection} />
                        )}
                      </div>
                    )}

                    {showCenterActionBar && (
                      <div className={styles.actionBar}>
                        {isMyAwaiting &&
                          !isDiscardPhase &&
                          pending?.prompt?.type === 'useCard' &&
                          !broadcastSkipped && (
                            <button className={styles.promptBtn} onClick={() => handleRespond()}>
                              不回应
                            </button>
                          )}
                        {canOperate &&
                          selectedActive &&
                          transformMode &&
                          transformMode.minCards > 1 &&
                          (() => {
                            const ids = transformMode.selectedCardIds;
                            const enough =
                              ids.length >= transformMode.minCards &&
                              ids.length <= transformMode.maxCards;
                            return (
                              <button
                                className={cx(
                                  styles.playBtn,
                                  (!enough || !selectedTarget) && styles.btnDisabled,
                                )}
                                onClick={() =>
                                  selectedTarget && enough && handleTransformPlay(selectedTarget)
                                }
                                disabled={!enough || !selectedTarget}
                              >
                                使用{transformMode.wrapperName}
                                {selectedTarget
                                  ? ` → ${selectedTarget}`
                                  : enough
                                    ? ' (请选目标)'
                                    : ` (还需选 ${transformMode.minCards - ids.length} 张)`}
                              </button>
                            );
                          })()}
                        {canOperate &&
                          selectedActive &&
                          transformMode?.minCards === 1 &&
                          selectedCardId && (
                            <button
                              className={cx(styles.playBtn, !selectedTarget && styles.btnDisabled)}
                              onClick={() => selectedTarget && handleTransformPlay(selectedTarget)}
                              disabled={!selectedTarget}
                            >
                              使用{transformMode.wrapperName}
                              {selectedTarget ? ` → ${selectedTarget}` : ' (请选目标)'}
                            </button>
                          )}
                        {canOperate &&
                          selectedActive &&
                          !transformMode &&
                          selectedCardId &&
                          playButtonState && (
                            <button
                              className={cx(
                                styles.playBtn,
                                !playButtonState.canPlay && styles.btnDisabled,
                              )}
                              onClick={handlePlayCard}
                              disabled={!playButtonState.canPlay}
                            >
                              出牌{playButtonState.targetLabel}
                            </button>
                          )}
                        {canOperate &&
                          !transformMode &&
                          selectedCardId &&
                          altActions.length > 0 &&
                          altActions.map((a) => (
                            <button
                              key={`${a.skillId}:${a.actionType}`}
                              className={styles.playBtn}
                              onClick={() => handleSkillAction(a)}
                            >
                              {a.label}
                            </button>
                          ))}
                        {showEndTurn && (
                          <button className={styles.endTurnBtn} onClick={handleEndTurn}>
                            结束回合
                          </button>
                        )}
                        {canOperate && isDiscardPhase && isPerspectiveAwaiting && (
                          <>
                            <button
                              className={cx(
                                styles.promptBtnPrimary,
                                (selectedForDiscard.size < discardMin ||
                                  selectedForDiscard.size > discardMax) &&
                                  styles.btnDisabled,
                              )}
                              disabled={
                                selectedForDiscard.size < discardMin ||
                                selectedForDiscard.size > discardMax
                              }
                              onClick={handleConfirmDiscard}
                            >
                              确认弃牌 ({selectedForDiscard.size}/{discardMin})
                            </button>
                            {selectedForDiscard.size > 0 && (
                              <button className={styles.promptBtn} onClick={clearDiscard}>
                                清空选择
                              </button>
                            )}
                          </>
                        )}
                        {canOperate &&
                          isDistributeActive &&
                          activeDistribute &&
                          (() => {
                            const mode = activeDistribute.prompt.mode ?? 'allocate';
                            const minTotal = activeDistribute.prompt.minTotal ?? 1;
                            const maxTotal = activeDistribute.prompt.maxTotal ?? 99;
                            let canSubmit: boolean;
                            let label: string;
                            if (mode === 'select') {
                              canSubmit =
                                distSelected.size >= minTotal && distSelected.size <= maxTotal;
                              label = `确认(${distSelected.size})`;
                            } else if (activeDistribute.externalTargetSelection) {
                              canSubmit =
                                distSelected.size >= minTotal &&
                                distSelected.size <= maxTotal &&
                                !!distTargetName;
                              label = `确定(${distSelected.size})${distTargetName ? ` → ${distTargetName}` : ''}`;
                            } else {
                              const total = distAllocations.flatMap((a) => a.cardIds).length;
                              canSubmit = total >= minTotal;
                              label = `提交分配(${total})`;
                            }
                            return (
                              <>
                                <button
                                  className={styles.promptBtn}
                                  onClick={handleDistClear}
                                  disabled={
                                    distSelected.size === 0 && distAllocations.length === 0
                                  }
                                >
                                  清空
                                </button>
                                <button
                                  className={cx(
                                    styles.promptBtnPrimary,
                                    !canSubmit && styles.btnDisabled,
                                  )}
                                  onClick={handleDistSubmit}
                                  disabled={!canSubmit}
                                >
                                  {label}
                                </button>
                                {distributeMode && (
                                  <CancelButton
                                    label="取消"
                                    onClick={() => setDistributeMode(null)}
                                  />
                                )}
                              </>
                            );
                          })()}
                        {selectedCardId &&
                          canOperate &&
                          isMyTurn &&
                          (playRules?.multiTarget
                            ? selectedMultiTargets.length > 0
                            : !!selectedTarget) && (
                          <div className={styles.targetHint}>
                            已选择目标:{' '}
                            {playRules?.multiTarget
                              ? selectedMultiTargets.join('、')
                              : selectedTarget}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                }
              />
            </DevProfiler>

            {/* 中央:牌堆/处理区 + 出牌历史条 */}
            <div className={styles.centerTable}>
              <ZoneInfoBar view={view} />
              <PlayHistoryStrip items={playHistoryItems} />
            </div>
          </div>
        </div>

        {/* 右侧边栏:日志/聊天 */}
        <div className={styles.rightSidebar}>
          <InfoDock
            view={view}
            chatMessages={chatMessages}
            chatConfig={chatConfig}
            onSendChat={onSendChat}
            mySeatIndex={view.viewer}
            embedded
          />
        </div>
      </div>

      {/* ─── 底栏:装备 | 手牌 | 我方武将 ─── */}
      <div className={styles.bottomLayout}>
        <EquipColumn
          perspectiveIdx={perspectiveIdx}
          view={view}
          canOperate={canOperate}
          skillActions={skillActions}
          onSkillAction={handleSkillAction}
          distCandidateEquipIds={activeDistribute ? new Set(activeDistribute.cardIds) : null}
          distSelectedEquipIds={distSelected}
          isDistributeActive={isDistributeActive}
          onEquipCardClick={handleEquipCardClick}
        />

        <div className={styles.handColumn}>
          <div className={styles.handHeader}>
            <div className={styles.phaseStrip}>
              <span className={styles.phaseStripBadge}>{view.phase}</span>
              <span className={styles.handTitle}>
                手牌 ({perspectiveHand.length})
                {isDistributeActive && activeDistribute && (
                  <span className={cx(styles.debugHint, styles.distHint)}>
                    {' '}
                    · {activeDistribute.prompt.title} · 已选 {distSelected.size}
                  </span>
                )}
              </span>
            </div>
          </div>
          {/* distribute 外部候选区:候选牌不在手牌/装备区时(观星/界破军等),单独渲染。
              点点击触发同一 handleCardClick → handleDistToggle(复用主流程候选选择逻辑)。n                手牌区/装备区的候选高亮仍由原逻辑处理,本区只补充"不在那些区域"的牌。 */}
          {isDistributeActive && distExternalCandidates.length > 0 && (
            <div className={styles.distExternalWrap}>
              <span className={styles.distExternalLabel}>
                {activeDistribute?.prompt.title ?? '候选牌'} · 已选 {distSelected.size}
              </span>
              <div className={styles.distExternalList}>
                {distExternalCandidates.map((card) => {
                  const isCandidate = true; // 本区的牌都是候选
                  const isSelected = distSelected.has(card.id);
                  const isAllocated = distAllocations.some((a) =>
                    a.cardIds.includes(card.id),
                  );
                  return (
                    <div
                      key={card.id}
                      data-card-id={card.id}
                      className={cx(
                        styles.distExternalCard,
                        isSelected && styles.handCardDistributeSelected,
                        isAllocated && styles.handCardDistributeAllocated,
                        !isSelected && !isAllocated && styles.handCardDistributeCandidate,
                      )}
                      style={
                        { '--suit-color': SUIT_COLOR[card.suit] ?? '#ccc' } as React.CSSProperties
                      }
                      onClick={() => handleCardClick(card)}
                      title={`${card.name} ${card.suit}${card.rank}`}
                    >
                      <div className={styles.cardName}>{card.name}</div>
                      <div className={styles.cardSuit}>
                        {card.suit}
                        {card.rank}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* 手牌区 */}
          <div className={styles.handList} ref={handListRef}>
            {orderedHand.map((card, i) => {
              const isSelected =
                selectedCardId === card.id ||
                !!(
                  transformMode &&
                  transformMode.minCards > 1 &&
                  transformMode.selectedCardIds.includes(card.id)
                );
              const isDiscardSelected = selectedForDiscard.has(card.id);
              const useAction = findUseActionForCard(skillActions, card);
              const playBlocked =
                isMyTurn &&
                canOperate &&
                !!useAction &&
                !isActiveAction(useAction, { view, perspectiveIdx });
              const canPlay = isMyTurn && canOperate && !playBlocked;
              const respondFilter = pendingRespondInfo?.cardFilter;
              const isAwaiting = !isDistributeActive && isMyAwaiting && !!respondFilter?.(card);
              const canDiscardClick = isDiscardPhase && isPerspectiveAwaiting && canOperate;
              const isTransformCandidate = !!transformMode?.cardFilter(card);
              const isTransformActive = transformMode !== null && isMyTurn && canOperate;
              const isTransformMatch =
                isTransformCandidate &&
                (transformMode?.minCards === 1 ||
                  !!transformMode?.selectedCardIds.includes(card.id));
              const isTransformDisabled = isTransformActive && !isTransformCandidate;
              const distCandidateIds = activeDistribute ? new Set(activeDistribute.cardIds) : null;
              const isDistCandidate = isDistributeActive && !!distCandidateIds?.has(card.id);
              const isDistSelected = isDistributeActive && distSelected.has(card.id);
              const isDistAllocated =
                isDistributeActive && distAllocations.some((a) => a.cardIds.includes(card.id));
              return (
                <div
                  key={card.id}
                  draggable={
                    !!onReorderHand && !isSelected && !isDiscardSelected && !isDistSelected
                  }
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(i)}
                >
                  <HandCard
                    card={card}
                    index={i}
                    totalHand={orderedHand.length}
                    isSelected={isSelected}
                    isDiscardSelected={isDiscardSelected}
                    canPlay={canPlay}
                    isAwaiting={isAwaiting}
                    canDiscardClick={canDiscardClick}
                    isTransformMatch={isTransformMatch}
                    isTransformActive={isTransformActive}
                    isTransformDisabled={isTransformDisabled}
                    transformWrapperName={transformMode?.wrapperName}
                    isDistributeCandidate={isDistCandidate}
                    isDistributeSelected={isDistSelected}
                    isDistributeAllocated={isDistAllocated}
                    isDistributeActive={isDistributeActive}
                    onCardClick={handleCardClick}
                  />
                </div>
              );
            })}
            {perspectiveHand.length === 0 && <div className={styles.emptyHand}>无手牌</div>}
          </div>
        </div>

        <div
          className={cx(
            styles.playerCardLarge,
            isPerspectiveTurn && styles.playerCardTurn,
            anim.damageFlashIndices.has(perspectiveIdx) && styles.seatShaking,
            anim.damageFlashIndices.has(perspectiveIdx) && styles.seatDamageOverlay,
            // 可选自己为目标(铁索连环含自己):高亮可点
            selfTargetable && styles.seatCardClickable,
            // 已选自己为目标:高亮选中
            selfSelectedAsTarget && styles.seatCardTargeted,
          )}
          data-seat-index={perspectiveIdx}
          onClick={() =>
            selfTargetable && handleTargetClick(perspectiveName)
          }
        >
          <DevProfiler id="PlayerCardLarge">
            <PlayerCardLarge
              perspectiveIdx={perspectiveIdx}
              viewer={view.viewer}
              view={view}
              damageFlashIndices={anim.damageFlashIndices}
              canOperate={canOperate}
              isPerspectiveTurn={isPerspectiveTurn}
              skillActions={skillActions}
              onSkillAction={handleSkillAction}
            />
          </DevProfiler>
        </div>
      </div>
    </div>
  );
}

/**
 * React.memo:顶层组件在 view 未变时跳过重渲染。
 * headerSlot/overlaySlot 是上层 JSX,引用每次变化——比较器中按引用比较,
 * 实际拦截发生在子组件层(PlayerSeatView/HandCard 等的自定义 comparator)。
 */
export const GameViewComponent = memo(GameViewComponentImpl);
