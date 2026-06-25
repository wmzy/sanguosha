// src/client/components/GameView.tsx
// 完整游戏界面主组件。
//
// 职责:编排子组件 + 转发 hook 产出的状态/handler 到对应展示组件。
// 展示逻辑全部委托给子组件(GameHeader/OverlaysLayer/AwaitingPrompt/PlayPhasePrompt/
// TargetSelector/SeatArcLayout/ZoneInfoBar/HandCard/PlayerCardLarge)。
// 状态派生委托给 hooks(useSkillActions/usePendingState/useCharSelect/useSeatOrder/
// useAnimationState/useHandReorder/usePlayInteraction)。
//
// 不感知视角切换:本组件只渲染 view.viewer 这一个视角的游戏画面。
//   正式模式:上层直接传入 view,viewer 就是当前玩家。
//   debug 模式:上层(DebugLobby)管理多连接 + 视角切换,把当前视角连接的 view 传入,
//   并通过 headerSlot/overlaySlot 注入视角控制 UI。切换视图、自动跟随、代打等逻辑
//   均在上层,本组件不可见。
//
// 布局: GameHeader → 提示区 → 座位弧形(其他玩家) → [左:角色大卡 | 右:倒计时+操作+目标+手牌] → 日志
import { useState, useCallback, useRef, type ReactNode } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView as EngineGameView, Card, Json } from '../../engine/types';
import { CountdownBar, DEFAULT_COUNTDOWN_TOTAL_MS } from './CountdownBar';
import { PlayerCardLarge } from './PlayerCardLarge';
import { GameLog } from './GameLog';

// ─── 抽取的子组件 ───
import { GameHeader } from './GameHeader';
import { OverlaysLayer } from './OverlaysLayer';
import { AwaitingPrompt } from './AwaitingPrompt';
import { PlayPhasePrompt } from './PlayPhasePrompt';
import { TargetSelector } from './TargetSelector';
import { SeatArcLayout } from './SeatArcLayout';
import { ZoneInfoBar } from './ZoneInfoBar';
import { HandCard } from './HandCard';
import { DistributeUI } from './DistributeUI';
import { CancelButton } from './CancelButton';

// ─── 抽取的 hooks ───
import { useAnimationState } from '../hooks/useAnimationState';
import { useSkillActions } from '../hooks/useSkillActions';
import { usePendingState } from '../hooks/usePendingState';
import { useCharSelect } from '../hooks/useCharSelect';
import { useSeatOrder } from '../hooks/useSeatOrder';
import { useHandReorder } from '../hooks/useHandReorder';
import { usePlayInteraction } from '../hooks/usePlayInteraction';

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
}

// ─── 主组件 ───
// 纯净的单视角组件:只渲染 view.viewer 的游戏画面,不感知视角切换。
//   正式模式:上层直接传入当前玩家的 view。
//   debug 模式:上层(DebugLobby)管理多连接和视角切换,把当前视角连接的 view 传入,
//   并通过 headerSlot/overlaySlot 注入视角控制 UI。
export function GameViewComponent({ view, onAction, onReorderHand, onSeatDoubleClick, headerSlot, overlaySlot }: Props) {
  const perspectiveIdx = view.viewer;
  const [showIdentityReveal, setShowIdentityReveal] = useState(() => !sessionStorage.getItem('sgs_identity_shown'));

  // ─── 状态派生(hooks) ───
  const { skillActions } = useSkillActions(view, perspectiveIdx);
  const pendingState = usePendingState(view, perspectiveIdx, skillActions);
  const { pending, pendingTargetIdx, isPerspectiveAwaiting, isDiscardPhase, discardMin, discardMax, skippedBroadcast, markBroadcastSkipped, deadline, deadlineTotalMs, pendingRespondInfo, broadcastKey } = pendingState;
  const { isCharSelectPending, charSelect, charSelectInProgress } = useCharSelect(view, perspectiveIdx);
  const orderedPlayers = useSeatOrder(view, perspectiveIdx);
  const anim = useAnimationState(view, perspectiveIdx);

  const handListRef = useRef<HTMLDivElement>(null);

  const perspectivePlayer = view.players[perspectiveIdx];
  const perspectiveName = perspectivePlayer.name ?? `P${perspectiveIdx}`;
  const isPerspectiveTurn = view.currentPlayerIndex === perspectiveIdx;
  const isMyTurn = isPerspectiveTurn;
  const currentPlayer = view.players[view.currentPlayerIndex];
  const currentPlayerName = currentPlayer.name;
  const perspectiveHand: Card[] = perspectivePlayer.hand ?? [];

  // 手牌拖拽重排(已抽出到 useHandReorder)
  const { orderedHand, handleDragStart, handleDrop } = useHandReorder(perspectiveHand, onReorderHand);

  const canOperate = true;

  // 发送 action(出牌交互状态机共享的底层函数)
  const send = useCallback(
    (skillId: string, actionType: string, params: Record<string, Json>, preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>) => {
      onAction({ skillId, actionType, ownerId: perspectiveIdx, params, preceding });
    },
    [onAction, perspectiveIdx],
  );

  // ─── 出牌交互状态机(已抽出到 usePlayInteraction) ───
  const play = usePlayInteraction(isMyTurn, canOperate, {
    view, perspectiveIdx, perspectiveHand, skillActions,
    pending, isDiscardPhase, discardMin, discardMax,
    isPerspectiveAwaiting, pendingRespondInfo, broadcastKey,
    markBroadcastSkipped, pendingTargetIdx, send, handListRef,
  });
  const {
    selectedCardId, selectedTarget, selectedKillTarget, selectedForDiscard,
    transformMode, distributeMode, activeDistribute, isDistributeActive,
    distSelected, distAllocations, distTargetName,
    selectedActive, playButtonState, multiTransformReady, showTargetSelector,
    selectedTargetFilter, playRules,
    handleCardClick, handlePlayCard, handleTargetClick, handleSlotSelect,
    handleSkillAction, handleTransformPlay, handleRespond, handleEndTurn,
    handleConfirmDiscard, isTargetable,
    handleDistToggle, handleDistAllocate, handleDistSubmit, handleDistClear,
    cancelTransform, cancelSelection, clearDiscard, setDistributeMode,
  } = play;

  const isMyAwaiting = isPerspectiveAwaiting && canOperate;

  return (
    <div className={styles.pageRoot}>
      <OverlaysLayer
        view={view}
        perspectiveIdx={perspectiveIdx}
        isCharSelectPending={isCharSelectPending}
        charSelect={charSelect}
        charSelectInProgress={charSelectInProgress}
        showIdentityReveal={showIdentityReveal}
        onIdentityConfirm={() => {
          setShowIdentityReveal(false);
          sessionStorage.setItem('sgs_identity_shown', '1');
        }}
        onAction={onAction}
        overlaySlot={overlaySlot}
      />

      <GameHeader
        view={view}
        animTurnVersion={anim.turnVersion}
        animPhaseVersion={anim.phaseVersion}
        currentPlayerName={currentPlayerName}
        headerSlot={headerSlot}
      />

      {/* ─── 座位布局(弧形) + 中央信息 ─── */}
      <div className={styles.seatingArea}>
        <SeatArcLayout
          view={view}
          orderedPlayers={orderedPlayers}
          perspectiveName={perspectiveName}
          currentPlayerName={currentPlayerName}
          selectedNeedsTarget={(!!playRules && playRules.needsTarget) || (isDistributeActive && !!activeDistribute?.externalTargetSelection)}
          selectedTarget={isDistributeActive && activeDistribute?.externalTargetSelection ? distTargetName : selectedTarget}
          isTargetable={isTargetable}
          onTargetClick={handleTargetClick}
          onSeatDoubleClick={onSeatDoubleClick}
          damageFlashIndices={anim.damageFlashIndices}
          turnVersion={anim.turnVersion}
        />
        <ZoneInfoBar view={view} />
      </div>

      {/* ─── 下方主区域:左 角色大卡 / 右 手牌+操作 ─── */}
      <div className={styles.bottomLayout}>
        <div className={styles.playerCardLarge}>
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
        </div>

        <div className={styles.handColumn}>
          {/* ─── 待回应区(pending 回应,非弃牌/非选将/非 distribute)─── */}
          {/* distribute pending(遗计)由下方统一分配面板处理 */}
          {isPerspectiveAwaiting && pending && !isDiscardPhase && pending?.atom?.type !== '选将询问' && pending.prompt.type !== 'distribute' && (
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
              onSend={send}
              onRespond={handleRespond}
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
            onClearDiscard={clearDiscard}
            onConfirmDiscard={handleConfirmDiscard}
          />
          {/* ─── 统一分配面板(仁德/制衡主动技 + 遗计被动 pending)─── */}
          {/* 选牌已下沉到手牌区,这里只显示提示文案 + 目标分配 + 提交 */}
          {isDistributeActive && activeDistribute && (
            <div className={styles.promptBoxAwaiting}>
              <div className={styles.promptTitle}>🤝 {activeDistribute.prompt.title}</div>
              <DistributeUI
                prompt={activeDistribute.prompt}
                cardIds={activeDistribute.cardIds}
                players={view.players}
                viewer={perspectiveIdx}
                selected={distSelected}
                allocations={distAllocations}
                onToggleCard={handleDistToggle}
                onAllocate={handleDistAllocate}
                onClear={handleDistClear}
                onSubmit={handleDistSubmit}
                externalTargetSelection={activeDistribute.externalTargetSelection}
                externalTargetName={activeDistribute.externalTargetSelection ? distTargetName : undefined}
              />
              {/* 主动技可取消;被动 pending 不能取消 */}
              {distributeMode && (
                <div className={styles.distributeCancelRow}>
                  <CancelButton onClick={() => setDistributeMode(null)} />
                </div>
              )}
            </div>
          )}
          <CountdownBar deadline={deadline} totalMs={deadlineTotalMs || DEFAULT_COUNTDOWN_TOTAL_MS} />
          {/* 转化模式提示 + 取消选择 */}
          <div className={styles.handHeader}>
            <span className={styles.handTitle}>
              {perspectiveName} 的手牌 ({perspectiveHand.length})
              {transformMode && (
                <span className={cx(styles.debugHint, styles.transformHint)}>
                  ⚡ 转化模式:选{transformMode.minCards > 1 ? `${transformMode.minCards}张` : '1张'}{transformMode.wrapperName}{transformMode.minCards > 1 ? `(${transformMode.selectedCardIds.length}/${transformMode.maxCards})` : ''} · 源技能 {transformMode.skillId}
                </span>
              )}
            </span>
            {transformMode && (
              <CancelButton label="取消转化" onClick={cancelTransform} />
            )}
            {!transformMode && selectedCardId && (
              <CancelButton label="取消选择" onClick={cancelSelection} />
            )}
          </div>
          {/* 操作面板:出牌/结束回合/目标提示 */}
          <div className={styles.actionBar}>
            {canOperate && selectedActive && transformMode && transformMode.minCards > 1 && (() => {
              const ids = transformMode.selectedCardIds;
              const enough = ids.length >= transformMode.minCards && ids.length <= transformMode.maxCards;
              return (
                <button className={cx(styles.playBtn, (!enough || !selectedTarget) && styles.btnDisabled)} onClick={() => selectedTarget && enough && handleTransformPlay(selectedTarget)} disabled={!enough || !selectedTarget}>
                  使用{transformMode.wrapperName}{selectedTarget ? ` → ${selectedTarget}` : enough ? ' (请选目标)' : ` (还需选 ${transformMode.minCards - ids.length} 张)`}
                </button>
              );
            })()}
            {canOperate && selectedActive && transformMode && transformMode.minCards === 1 && selectedCardId && (
              <button className={cx(styles.playBtn, !selectedTarget && styles.btnDisabled)} onClick={() => selectedTarget && handleTransformPlay(selectedTarget)} disabled={!selectedTarget}>
                使用{transformMode.wrapperName}{selectedTarget ? ` → ${selectedTarget}` : ' (请选目标)'}
              </button>
            )}
            {canOperate && selectedActive && !transformMode && selectedCardId && playButtonState && (
              <button className={cx(styles.playBtn, !playButtonState.canPlay && styles.btnDisabled)} onClick={handlePlayCard} disabled={!playButtonState.canPlay}>
                出牌{playButtonState.targetLabel}
              </button>
            )}
            {canOperate && isMyTurn && (view.phase === '出牌' || view.phase === '弃牌') && (
              <button className={styles.endTurnBtn} onClick={handleEndTurn}>结束回合</button>
            )}
            {selectedCardId && selectedTarget && canOperate && isMyTurn && (
              <div className={styles.targetHint}>已选择目标: {selectedTarget}</div>
            )}
          </div>
          {/* 目标选择面板 */}
          {showTargetSelector && (selectedCardId || multiTransformReady) && (
            <TargetSelector
              view={view}
              perspectiveIdx={perspectiveIdx}
              selectedCardId={selectedCardId ?? ''}
              perspectiveHand={perspectiveHand}
              transformMode={transformMode}
              targetFilter={selectedTargetFilter}
              selectedTarget={selectedTarget}
              selectedKillTarget={selectedKillTarget}
              isTargetable={isTargetable}
              onTargetClick={handleTargetClick}
              onSlotSelect={handleSlotSelect}
              onTransformPlay={handleTransformPlay}
            />
          )}
          {/* 手牌区 */}
          <div className={styles.handList} ref={handListRef}>
            {/* respond cardFilter 提取到 map 外部(memo 后的 pendingRespondInfo),
                避免原先在每张牌的 map 回调里重复 resolve。 */}
            {orderedHand.map((card, i) => {
              const isSelected = selectedCardId === card.id
                || !!(transformMode && transformMode.minCards > 1 && transformMode.selectedCardIds.includes(card.id));
              const isDiscardSelected = selectedForDiscard.has(card.id);
              const canPlay = isMyTurn && canOperate;
              // distribute 激活时不走 useCard 回应高亮(避免遗计 pending 双高亮)
              const respondFilter = pendingRespondInfo?.cardFilter;
              const isAwaiting = !isDistributeActive && isMyAwaiting && !!respondFilter?.(card);
              const canDiscardClick = isDiscardPhase && isPerspectiveAwaiting && canOperate;
              const isTransformMatch = transformMode !== null && transformMode.cardFilter(card);
              const isTransformActive = transformMode !== null && isMyTurn && canOperate;
              const isTransformDisabled = isTransformActive && !isTransformMatch;
              // distribute(仁德/制衡/遗计):候选/选中/已分配
              const distCandidateIds = activeDistribute ? new Set(activeDistribute.cardIds) : null;
              const isDistCandidate = isDistributeActive && !!distCandidateIds?.has(card.id);
              const isDistSelected = isDistributeActive && distSelected.has(card.id);
              const isDistAllocated = isDistributeActive && distAllocations.some(a => a.cardIds.includes(card.id));
              const isNew = anim.newCardIds.has(card.id);
              return (
                <div
                  key={card.id}
                  draggable={!!onReorderHand && !isSelected && !isDiscardSelected && !isDistSelected}
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
                  isNew={isNew}
                  transformWrapperName={transformMode?.wrapperName}
                  isDistributeCandidate={isDistCandidate}
                  isDistributeSelected={isDistSelected}
                  isDistributeAllocated={isDistAllocated}
                  isDistributeActive={isDistributeActive}
                  onClick={() => handleCardClick(card)}
                />
                </div>
              );
            })}
            {perspectiveHand.length === 0 && <div className={styles.emptyHand}>无手牌</div>}
          </div>
        </div>
      </div>

      <GameLog view={view} />
    </div>
  );
}
