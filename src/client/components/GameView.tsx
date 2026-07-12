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
// 布局: GameHeader → 提示区 → 座位弧形(其他玩家) → [左:角色大卡 | 右:倒计时+操作+目标+手牌] → 日志
import { useState, useCallback, useRef, memo, type ReactNode } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView as EngineGameView, Card, Json } from '../../engine/types';
import { getAtomDef } from '../../engine/atom';
import { CountdownBar, DEFAULT_COUNTDOWN_TOTAL_MS } from './CountdownBar';
import { PlayerCardLarge } from './PlayerCardLarge';
import { GameLog } from './GameLog';
import { EventBanner } from './EventBanner';
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
import { findUseActionForCard, isActiveAction } from '../utils/gameViewHelpers';

// ─── 抽取的 hooks ───
import { useAnimationState } from '../hooks/useAnimationState';
import { useSkillActions } from '../hooks/useSkillActions';
import { usePendingState } from '../hooks/usePendingState';
import { useCharSelect } from '../hooks/useCharSelect';
import { useSeatOrder } from '../hooks/useSeatOrder';
import { useHandReorder } from '../hooks/useHandReorder';
import { usePlayInteraction } from '../hooks/usePlayInteraction';
import { useProcessingPicks } from '../hooks/useProcessingPicks';

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
  /** 只读模式(回放):禁用选将/身份揭示等阻塞性遮罩,避免遮挡游戏画面。
   *  正式/debug 模式不传(默认 false),保持原有选将流程。 */
  readOnly?: boolean;
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
  readOnly = false,
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

  const canOperate = true;

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
    selectedForDiscard,
    transformMode,
    distributeMode,
    activeDistribute,
    isDistributeActive,
    distSelected,
    distAllocations,
    distTargetName,
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

      {/* ─── 事件横幅(延时展示,非阻塞) ─── */}
      <EventBanner current={currentEvent ?? null} view={view} />

      {/* ─── 座位布局(弧形) + 中央信息 ─── */}
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
                  : selectedTarget
                    ? [selectedTarget]
                    : []
            }
            isTargetable={isTargetable}
            onTargetClick={handleTargetClick}
            onSeatDoubleClick={onSeatDoubleClick}
            damageFlashIndices={anim.damageFlashIndices}
            turnVersion={anim.turnVersion}
          />
        </DevProfiler>
        <ZoneInfoBar view={view} />
      </div>

      {/* ─── 下方主区域:左 角色大卡 / 右 手牌+操作 ─── */}
      <div className={styles.bottomLayout}>
        {/* ─── 左:装备区纵向列 ─── */}
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
          {/* ─── 待回应区(pending 回应,非弃牌/非选将/非 distribute)─── */}
          {/* distribute pending(遗计)由下方统一分配面板处理 */}
          {/* 翻牌动画(blockUntilDone)期间延迟:让玩家先看清判定结果再弹出询问 */}
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
          {/* 自己的进度条:自己需要操作时显示 ——
              1) 被询问(isPerspectiveAwaiting:阻塞型 pending 命中自己)
              2) 自己出牌阶段(出牌窗口是非阻塞 pending,不计入 awaiting,但同样需要倒计时) */}
          {(isPerspectiveAwaiting || (isMyTurn && view.phase === '出牌')) && !broadcastSkipped && (
            <CountdownBar
              deadline={deadline}
              totalMs={deadlineTotalMs || DEFAULT_COUNTDOWN_TOTAL_MS}
            />
          )}
          {/* 转化模式提示 + 取消选择 */}
          <div className={styles.handHeader}>
            <span className={styles.handTitle}>
              {perspectiveName} 的手牌 ({perspectiveHand.length})
              {isDistributeActive && activeDistribute && (
                <span className={cx(styles.debugHint, styles.distHint)}>
                  🤝 {activeDistribute.prompt.title} · 已选 {distSelected.size}
                </span>
              )}
              {transformMode && (
                <span className={cx(styles.debugHint, styles.transformHint)}>
                  ⚡ 转化模式:选{transformMode.minCards > 1 ? `${transformMode.minCards}张` : '1张'}
                  {transformMode.wrapperName}
                  {transformMode.minCards > 1
                    ? `(${transformMode.selectedCardIds.length}/${transformMode.maxCards})`
                    : ''}{' '}
                  · 源技能 {transformMode.skillId}
                </span>
              )}
            </span>
            {transformMode && <CancelButton label="取消转化" onClick={cancelTransform} />}
            {!transformMode && selectedCardId && (
              <CancelButton label="取消选择" onClick={cancelSelection} />
            )}
          </div>
          {/* 操作面板:出牌/不回应/结束回合 */}
          <div className={styles.actionBar}>
            {/* useCard 待回应:不回应按钮(从 AwaitingPrompt 移至统一操作区)。 */}
            {/* 排除弃牌阶段:弃牌 pending 复用 useCard prompt,由「确认弃牌」处理。 */}
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
                  ids.length >= transformMode.minCards && ids.length <= transformMode.maxCards;
                return (
                  <button
                    className={cx(
                      styles.playBtn,
                      (!enough || !selectedTarget) && styles.btnDisabled,
                    )}
                    onClick={() => selectedTarget && enough && handleTransformPlay(selectedTarget)}
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
            {canOperate && selectedActive && transformMode?.minCards === 1 && selectedCardId && (
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
                  className={cx(styles.playBtn, !playButtonState.canPlay && styles.btnDisabled)}
                  onClick={handlePlayCard}
                  disabled={!playButtonState.canPlay}
                >
                  出牌{playButtonState.targetLabel}
                </button>
              )}
            {/* 替代出牌方式(如铁索连环·重铸):选中牌后额外显示 */}
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
            {canOperate && isMyTurn && (view.phase === '出牌' || view.phase === '弃牌') && (
              <button className={styles.endTurnBtn} onClick={handleEndTurn}>
                结束回合
              </button>
            )}
            {/* 弃牌阶段:确认弃牌 / 清空选择(与结束回合并排) */}
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
                    selectedForDiscard.size < discardMin || selectedForDiscard.size > discardMax
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
            {/* distribute(制衡/仁德/遗计):提交/清空按钮。候选牌在手牌区+装备区卡片选,目标在座位区选 */}
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
                  canSubmit = distSelected.size >= minTotal && distSelected.size <= maxTotal;
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
                      disabled={distSelected.size === 0 && distAllocations.length === 0}
                    >
                      清空
                    </button>
                    <button
                      className={cx(styles.promptBtnPrimary, !canSubmit && styles.btnDisabled)}
                      onClick={handleDistSubmit}
                      disabled={!canSubmit}
                    >
                      {label}
                    </button>
                    {distributeMode && (
                      <CancelButton label="取消" onClick={() => setDistributeMode(null)} />
                    )}
                  </>
                );
              })()}
            {selectedCardId && selectedTarget && canOperate && isMyTurn && (
              <div className={styles.targetHint}>已选择目标: {selectedTarget}</div>
            )}
          </div>
          {/* 手牌区 */}
          <div className={styles.handList} ref={handListRef}>
            {/* respond cardFilter 提取到 map 外部(memo 后的 pendingRespondInfo),
                避免原先在每张牌的 map 回调里重复 resolve。 */}
            {orderedHand.map((card, i) => {
              const isSelected =
                selectedCardId === card.id ||
                !!(
                  transformMode &&
                  transformMode.minCards > 1 &&
                  transformMode.selectedCardIds.includes(card.id)
                );
              const isDiscardSelected = selectedForDiscard.has(card.id);
              // 出牌阶段该牌是否仍可玩:有 use action 但不 active(如杀超上限)时不可选中。
              // 无 use action 的牌(闪,出牌阶段本就不可主动出)不受此限,保持原行为。
              const useAction = findUseActionForCard(skillActions, card);
              const playBlocked =
                isMyTurn &&
                canOperate &&
                !!useAction &&
                !isActiveAction(useAction, { view, perspectiveIdx });
              const canPlay = isMyTurn && canOperate && !playBlocked;
              // distribute 激活时不走 useCard 回应高亮(避免遗计 pending 双高亮)
              const respondFilter = pendingRespondInfo?.cardFilter;
              const isAwaiting = !isDistributeActive && isMyAwaiting && !!respondFilter?.(card);
              const canDiscardClick = isDiscardPhase && isPerspectiveAwaiting && canOperate;
              const isTransformCandidate = !!transformMode?.cardFilter(card);
              const isTransformActive = transformMode !== null && isMyTurn && canOperate;
              // 显示转化后牌名:单卡转化(武圣)= 所有候选牌;多卡转化(丈八蛇矛)= 仅已选中牌
              const isTransformMatch =
                isTransformCandidate &&
                (transformMode?.minCards === 1 ||
                  !!transformMode?.selectedCardIds.includes(card.id));
              // 置灰/不可点:转化激活但非候选牌(丈八蛇矛任意牌都是候选,故不置灰)
              const isTransformDisabled = isTransformActive && !isTransformCandidate;
              // distribute(仁德/制衡/遗计):候选/选中/已分配
              const distCandidateIds = activeDistribute ? new Set(activeDistribute.cardIds) : null;
              const isDistCandidate = isDistributeActive && !!distCandidateIds?.has(card.id);
              const isDistSelected = isDistributeActive && distSelected.has(card.id);
              const isDistAllocated =
                isDistributeActive && distAllocations.some((a) => a.cardIds.includes(card.id));
              const isNew = anim.newCardIds.has(card.id);
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
                    isNew={isNew}
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

        {/* ─── 右:自己的武将卡片(回合金色高亮边框) ─── */}
        <div className={cx(styles.playerCardLarge, isPerspectiveTurn && styles.playerCardTurn)}>
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

      <DevProfiler id="GameLog">
        <GameLog view={view} />
      </DevProfiler>
    </div>
  );
}

/**
 * React.memo:顶层组件在 view 未变时跳过重渲染。
 * headerSlot/overlaySlot 是上层 JSX,引用每次变化——比较器中按引用比较,
 * 实际拦截发生在子组件层(PlayerSeatView/HandCard 等的自定义 comparator)。
 */
export const GameViewComponent = memo(GameViewComponentImpl);
