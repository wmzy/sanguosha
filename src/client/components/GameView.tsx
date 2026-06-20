// src/client/components/GameView.tsx
// 完整游戏界面主组件(重构后)。
//
// 职责:状态管理 + 事件 handler + 编排子组件。
// 展示逻辑全部委托给子组件(GameHeader/OverlaysLayer/AwaitingPrompt/PlayPhasePrompt/
// TargetSelector/SeatArcLayout/ZoneInfoBar/HandCard/PlayerCardLarge)。
// 状态派生委托给 hooks(useSkillActions/usePendingState/useCharSelect/useSeatOrder/useAnimationState)。
//
// 布局: GameHeader → 提示区 → 座位弧形(其他玩家) → [左:角色大卡 | 右:倒计时+操作+目标+手牌] → 日志
import { useState, useCallback, useEffect, useRef } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView as EngineGameView, Card, Json, DistributePrompt } from '../../engine/types';
import { CountdownBar, DEFAULT_COUNTDOWN_TOTAL_MS } from './CountdownBar';
import { PlayerCardLarge } from './PlayerCardLarge';
import { GameLog } from './GameLog';
import { createCardFlyAnimation } from '../utils/cardFlyAnimation';
import { resolvePendingRespond } from '../utils/pendingRespond';
import { buildPlayParams, playCardSkillId, derivePlayRules } from '../utils/gameViewHelpers';
import { findActionAcrossOwners } from '../skillActionRegistry';

// ─── 抽取的子组件 ───
import { GameHeader } from './GameHeader';
import { OverlaysLayer } from './OverlaysLayer';
import { AwaitingPrompt } from './AwaitingPrompt';
import { PlayPhasePrompt } from './PlayPhasePrompt';
import { TargetSelector } from './TargetSelector';
import { SeatArcLayout } from './SeatArcLayout';
import { ZoneInfoBar } from './ZoneInfoBar';
import { HandCard } from './HandCard';

// ─── 抽取的 hooks ───
import { useAnimationState } from '../hooks/useAnimationState';
import { useSkillActions } from '../hooks/useSkillActions';
import { usePendingState } from '../hooks/usePendingState';
import { useCharSelect } from '../hooks/useCharSelect';
import { useSeatOrder } from '../hooks/useSeatOrder';

import type { SkillActionDef } from '../skillActionRegistry';

// ─── ActionMsg: 发给 controller(不含 baseSeq) ───
export interface ActionMsg {
  skillId: string;
  actionType: string;
  ownerId: number;
  params: Record<string, Json>;
  /** 组合 action:在主 action 前顺序执行的前置 action(转化类,如武圣) */
  preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>;
}

interface Props {
  view: EngineGameView;
  onAction: (action: ActionMsg) => void;
  /** 当前视角座次(看谁)。正式模式 = viewer;debug 模式由上层控制(多视角切换)。 */
  perspective: number;
  /** 循环切换到下一视角(debug 模式提供时,header 渲染视角切换按钮)。 */
  onSwitchPerspective?: () => void;
  /** 跳转到当前玩家回调(debug 模式提供时,header 渲染「查看当前玩家」按钮)。 */
  onGoToCurrentPlayer?: () => void;
  /** 直接切到指定座次(点座位卡切换视角等)。 */
  onPerspectiveChange?: (idx: number) => void;
  /** 自动跟随开关状态(debug 模式提供时,header 渲染「自动切换」按钮)。 */
  autoSwitchCtl?: { enabled: boolean; toggle: () => void };
  /** 退出/删除房间(可选;debug 模式提供时渲染「退出」按钮)。 */
  onDeleteRoom?: () => void;
}

/** 转化模式:点武圣等转化技能后进入此模式,匹配卡牌显示为转化后的牌 */
interface TransformMode {
  skillId: string;
  actionType: string;
  cardFilter: (c: Card) => boolean;
  wrapperName: string;
}

// ─── 主组件 ───
// 纯净的单视角组件:perspective(看谁)由上层决定。
//   正式模式:上层传 perspective=view.viewer,固定看自己。
//   debug 模式:上层(DebugLobby)管理视角切换,传当前 perspective。
// 多视角切换/自动跟随/代打逻辑不在本组件内——那是上层的职责。
export function GameViewComponent({ view, onAction, perspective, onSwitchPerspective, onGoToCurrentPlayer, onPerspectiveChange, autoSwitchCtl, onDeleteRoom }: Props) {
  const perspectiveIdx = perspective;
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedKillTarget, setSelectedKillTarget] = useState<string | null>(null);
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<string>>(new Set());
  const [transformMode, setTransformMode] = useState<TransformMode | null>(null);
  const [distributeMode, setDistributeMode] = useState<{ skillId: string; actionType: string; prompt: DistributePrompt } | null>(null);
  const [showIdentityReveal, setShowIdentityReveal] = useState(() => !sessionStorage.getItem('sgs_identity_shown'));

  // ─── 状态派生(hooks) ───
  const { skillActions } = useSkillActions(view, perspectiveIdx);
  const pendingState = usePendingState(view, perspectiveIdx);
  const { pending, pendingTargetIdx, isPerspectiveAwaiting, isDiscardPhase, discardMin, discardMax, skippedBroadcast, markBroadcastSkipped, deadline } = pendingState;
  const { isCharSelectPending, charSelect, charSelectInProgress, perspectiveCharSelected } = useCharSelect(view, perspectiveIdx);
  const orderedPlayers = useSeatOrder(view, perspectiveIdx);
  const anim = useAnimationState(view, perspectiveIdx);

  const handListRef = useRef<HTMLDivElement>(null);

  const perspectivePlayer = view.players[perspectiveIdx];
  const perspectiveName = perspectivePlayer?.name ?? `P${perspectiveIdx}`;
  const isPerspectiveTurn = view.currentPlayerIndex === perspectiveIdx;
  const isMyTurn = isPerspectiveTurn;
  const currentPlayer = view.players[view.currentPlayerIndex];
  const currentPlayerName = currentPlayer?.name ?? '';
  const perspectiveHand: Card[] = perspectivePlayer?.hand ?? [];

  // 上层传入 perspective 即意味着该视角可操作(正式模式只传 viewer,
  // debug 模式上层保证视角合法性),故恒为 true。后续 handler 仅检查 isMyTurn/isPerspectiveAwaiting。
  const canOperate = true;
  const isMyAwaiting = isPerspectiveAwaiting && canOperate;

  // ─── state 重置 effects(切牌/切 pending 时清理) ───
  // 弃牌窗口出现/切换时清空已选
  useEffect(() => { setSelectedForDiscard(new Set()); }, [pending]);
  // 切牌/重选牌时,同步重置借刀杀人的第二目标
  useEffect(() => { setSelectedKillTarget(null); }, [selectedCardId]);

  // ─── 发送 action ───
  /** 发送 action。preceding 用于组合 action(转化技:武圣红牌当杀) */
  const send = useCallback(
    (skillId: string, actionType: string, params: Record<string, Json>, preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>) => {
      onAction({ skillId, actionType, ownerId: perspectiveIdx, params, preceding });
      setSelectedCardId(null);
      setSelectedTarget(null);
      setSelectedKillTarget(null);
    },
    [onAction, perspectiveIdx],
  );

  /** distribute 主动技提交后退出分配模式 */
  const sendDistribute = useCallback(
    (skillId: string, actionType: string, params: Record<string, Json>) => {
      send(skillId, actionType, params);
      setDistributeMode(null);
    },
    [send],
  );

  // ─── 选中的牌 ───
  const selectedCard = selectedCardId ? perspectiveHand.find(c => c.id === selectedCardId) ?? null : null;

  /** 判断目标 i 是否可被选中(距离/范围检查)。
   *  由选中卡 use action 的 targetFilter.filter 驱动(杀/顺手牵羊等声明了距离 filter)。
   *  无 filter 时恒可选(距离规则已后端 validate 兜底)。 */
  function isTargetable(i: number): boolean {
    const filter = selectedTargetFilter?.filter;
    if (!filter) return true;
    return filter(view, i);
  }

  // ─── 出牌/目标/技能 handlers ───
  function nameToIndex(name: string): number {
    return view.players.findIndex(p => p.name === name);
  }

  function handlePlayCard() {
    if (!selectedCardId) return;
    const card = perspectiveHand.find(c => c.id === selectedCardId);
    if (!card) return;
    // RESPOND_ONLY(闪/无懈)不能主动出:没有 use action 时 useAction 为 undefined
    if (!selectedUseAction) return;
    const rules = derivePlayRules(selectedTargetFilter, selectedUseAction.prompt.type === 'useCardAndTarget' && selectedUseAction.prompt.selfTarget);
    const params = buildPlayParams(view.players, perspectiveIdx, card, rules, selectedTarget, selectedKillTarget);
    if (params === null) return;
    // ─── 出牌飞行动画:在 card 消失前捕获位置,生成浮动元素 ───
    const cardEl = handListRef.current?.querySelector(`[data-card-id="${card.id}"]`) as HTMLElement | null;
    if (cardEl) {
      createCardFlyAnimation(cardEl, card);
    }
    send(playCardSkillId(card), 'use', params);
  }

  function handleTargetClick(name: string) {
    const idx = view.players.findIndex(p => p.name === name);
    if (idx >= 0 && !isTargetable(idx)) return; // 距离外,禁止选中
    setSelectedTarget(selectedTarget === name ? null : name);
  }

  // 多槽位目标选择(slots 模式,如借刀杀人 A+B):
  // slotIdx=0 选 A(切换 A 同时清 B);slotIdx>0 选对应槽位(允许再点取消)。
  // 当首槽位切换时,后续槽位重置。
  function handleSlotSelect(name: string, slotIdx: number) {
    if (slotIdx === 0) {
      if (selectedTarget === name) {
        setSelectedTarget(null);
        setSelectedKillTarget(null);
      } else {
        setSelectedTarget(name);
        setSelectedKillTarget(null);
      }
    } else {
      setSelectedKillTarget(selectedKillTarget === name ? null : name);
    }
  }

  function handleSkillAction(action: SkillActionDef) {
    const { skillId, actionType, prompt } = action;
    const params: Record<string, Json> = {};

    switch (prompt.type) {
      case 'useCard':
        if (!selectedCardId) return;
        params.cardId = selectedCardId;
        params.cardIds = [selectedCardId];
        break;
      case 'selectTarget':
        if (!selectedTarget) return;
        params.target = nameToIndex(selectedTarget);
        break;
      case 'useCardAndTarget':
        // 转化技能(如武圣):进入转化模式,用户从手牌中选匹配卡牌后再选目标
        if (action.transform) {
          if (prompt.cardFilter?.filter) {
            const sample = perspectiveHand.find(c => prompt.cardFilter!.filter!(c));
            const wrapperName = sample
              ? action.transform(sample).name
              : action.skillId;
            setTransformMode({ skillId, actionType, cardFilter: prompt.cardFilter.filter, wrapperName });
            setSelectedCardId(null);
            setSelectedTarget(null);
            return;
          }
        }
        if (!selectedCardId) return;
        if (!selectedTarget) return;
        {
          const idx = nameToIndex(selectedTarget);
          if (idx < 0) return;
          params.cardId = selectedCardId;
          const trickCard = perspectiveHand.find(c => c.id === selectedCardId);
          if (trickCard && (trickCard.type === '锦囊牌' && trickCard.trickSubtype === '延时锦囊')) {
            params.target = idx;
          } else {
            params.targets = [idx];
          }
        }
        break;
      case 'confirm':
        break;
      case 'choosePlayer':
        if (!selectedTarget) return;
        params.target = nameToIndex(selectedTarget);
        break;
      case 'distribute':
        setDistributeMode({ skillId, actionType, prompt });
        setSelectedCardId(null);
        setSelectedTarget(null);
        return;
      default:
        break;
    }

    send(skillId, actionType, params);
    setSelectedCardId(null);
    setSelectedTarget(null);
  }

  // ─── 转化模式:选完目标后,提交 preceding=[transform] + 转化后的牌.use ───
  function handleTransformPlay(targetName: string) {
    if (!transformMode || !selectedCardId) return;
    const targetCard = perspectiveHand.find(c => c.id === selectedCardId);
    if (!targetCard) return;
    const idx = nameToIndex(targetName);
    if (idx < 0) return;
    const shadowCardId = `${selectedCardId}#${transformMode.skillId}`;
    send(transformMode.wrapperName, 'use', { cardId: shadowCardId, targets: [idx] }, [{
      skillId: transformMode.skillId,
      actionType: transformMode.actionType,
      params: { cardId: selectedCardId },
    }]);
    setTransformMode(null);
    setSelectedCardId(null);
    setSelectedTarget(null);
  }

  function handleRespond(cardId?: string) {
    if (!pending) return;
    // 弃牌窗口超时:按顺序弃超出的牌(与 engine 超时回退一致:取最后 discardMin 张)
    if (isDiscardPhase) {
      if (selectedForDiscard.size >= discardMin) {
        handleConfirmDiscard();
      } else {
        const hand = perspectiveHand;
        const fallback = hand.slice(-discardMin).map(c => c.id);
        send('系统规则', 'respond', { cardIds: fallback });
        setSelectedForDiscard(new Set());
      }
      return;
    }
    const info = resolvePendingRespond(pending, skillActions);
    if (!info) return;
    if (cardId) {
      const card = perspectiveHand.find(c => c.id === cardId);
      if (!card) return;
      if (info.cardFilter && !info.cardFilter(card)) return;
      send(info.skillId, 'respond', { cardId });
    } else if (pendingTargetIdx < 0) {
      // 广播型 pending(如无懈可击 target=-2):"不回应"不发 action,仅本地标记跳过。
      markBroadcastSkipped(pending!.atom?.type + ':' + (pending!.atom as { requestType?: string }).requestType);
    } else {
      send(info.skillId, 'respond', {});
    }
  }

  function handleEndTurn() {
    if (!isMyTurn) return;
    send('回合管理', 'end', {});
  }

  function handleCardClick(card: Card) {
    // 弃牌窗口:切换弃牌选中状态
    if (isDiscardPhase && isPerspectiveAwaiting && canOperate) {
      setSelectedForDiscard(prev => {
        const next = new Set(prev);
        if (next.has(card.id)) {
          next.delete(card.id);
          return next;
        }
        if (next.size >= discardMax) return prev;
        next.add(card.id);
        return next;
      });
      return;
    }
    // 回应模式
    if (isMyAwaiting) {
      const info = resolvePendingRespond(pending, skillActions);
      if (info && info.cardFilter) {
        if (info.cardFilter(card)) handleRespond(card.id);
      }
      return;
    }
    // 转化模式(如武圣):只允许点击匹配的卡牌作为"被转化的原牌"
    if (transformMode && isMyTurn && canOperate) {
      if (!transformMode.cardFilter(card)) return;
      if (selectedCardId === card.id) {
        setSelectedCardId(null);
        setSelectedTarget(null);
      } else {
        setSelectedCardId(card.id);
        setSelectedTarget(null);
      }
      return;
    }
    // 出牌模式
    if (!isMyTurn || !canOperate) return;
    if (selectedCardId === card.id) {
      setSelectedCardId(null);
      setSelectedTarget(null);
    } else {
      setSelectedCardId(card.id);
      setSelectedTarget(null);
    }
  }

  function handleConfirmDiscard() {
    if (!pending || !isDiscardPhase) return;
    if (selectedForDiscard.size < discardMin || selectedForDiscard.size > discardMax) return;
    const cardIds = Array.from(selectedForDiscard);
    send('系统规则', 'respond', { cardIds });
    setSelectedForDiscard(new Set());
  }

  // ─── 出牌按钮是否可点(actionBar 用) ───
  // ─── 选中卡的 targetFilter(从 registry 的 use action 派生)───
  // 转化模式用 wrapperName 的 use action;普通出牌用 card.name。
  // 用于 TargetSelector 渲染 + playButtonState 可点性判断。
  const selectedCardName = (transformMode && selectedCardId)
    ? transformMode.wrapperName
    : (selectedCardId ? perspectiveHand.find(c => c.id === selectedCardId)?.name : undefined);
  const selectedUseAction = selectedCardName
    ? findActionAcrossOwners(selectedCardName, 'use')
    : undefined;
  const selectedTargetFilter = selectedUseAction?.prompt.type === 'useCardAndTarget'
    ? selectedUseAction.prompt.targetFilter
    : null;
  const selectedNeedsTargetCount = selectedTargetFilter
    ? (selectedTargetFilter.slots ? selectedTargetFilter.slots.length : selectedTargetFilter.max)
    : 0;

  // ─── 出牌按钮是否可点(actionBar 用)───
  const playButtonState = (() => {
    if (!selectedCardId) return null;
    const card = perspectiveHand.find(c => c.id === selectedCardId);
    if (!card || !selectedUseAction) return null;
    const rules = derivePlayRules(selectedTargetFilter, selectedUseAction.prompt.type === 'useCardAndTarget' && selectedUseAction.prompt.selfTarget);
    let canPlay: boolean;
    let targetLabel: string;
    if (rules.hasSlots) {
      canPlay = !!selectedTarget && !!selectedKillTarget;
      targetLabel = selectedTarget && selectedKillTarget
        ? ` → A=${selectedTarget} B=${selectedKillTarget}`
        : ' (请选 A/B 两个目标)';
    } else if (rules.selfTarget) {
      canPlay = true;
      targetLabel = '';
    } else {
      canPlay = !rules.needsTarget || !!selectedTarget;
      targetLabel = selectedTarget ? ` → ${selectedTarget}` : rules.needsTarget ? ' (请选目标)' : '';
    }
    return { canPlay, targetLabel };
  })();

  // 是否需要渲染目标选择面板:需要目标且非 selfTarget 时渲染
  const playRules = selectedUseAction
    ? derivePlayRules(selectedTargetFilter, selectedUseAction.prompt.type === 'useCardAndTarget' && selectedUseAction.prompt.selfTarget)
    : null;
  const showTargetSelector = selectedCardId !== null && canOperate && isMyTurn && !pending && !!playRules && playRules.needsTarget;

  return (
    <div className={styles.pageRoot}>
      <OverlaysLayer
        view={view}
        perspectiveIdx={perspectiveIdx}
        perspectiveName={perspectiveName}
        currentPlayerName={currentPlayerName}
        isCharSelectPending={isCharSelectPending}
        charSelect={charSelect}
        charSelectInProgress={charSelectInProgress}
        perspectiveCharSelected={perspectiveCharSelected}
        showIdentityReveal={showIdentityReveal}
        onIdentityConfirm={() => {
          setShowIdentityReveal(false);
          sessionStorage.setItem('sgs_identity_shown', '1');
        }}
        onSwitchPerspective={onSwitchPerspective}
        onGoToCurrentPlayer={onGoToCurrentPlayer}
        onAction={onAction}
      />

      <GameHeader
        view={view}
        animTurnVersion={anim.turnVersion}
        animPhaseVersion={anim.phaseVersion}
        currentPlayerName={currentPlayerName}
        perspectiveName={perspectiveName}
        onSwitchPerspective={onSwitchPerspective}
        onGoToCurrentPlayer={onGoToCurrentPlayer}
        autoSwitchCtl={autoSwitchCtl}
        onDeleteRoom={onDeleteRoom}
      />

      {/* ─── 待回应区(pending 回应,非弃牌/非选将) ─── */}
      {isPerspectiveAwaiting && pending && !isDiscardPhase && pending?.atom?.type !== '选将询问' && (
        <AwaitingPrompt
          pending={pending}
          pendingTargetIdx={pendingTargetIdx}
          perspectiveName={perspectiveName}
          perspectiveHand={perspectiveHand}
          skillActions={skillActions}
          skippedBroadcast={skippedBroadcast}
          canOperate={canOperate}
          onSend={send}
          onRespond={handleRespond}
          view={view}
          perspectiveIdx={perspectiveIdx}
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
        distributeMode={distributeMode}
        onCancelDistribute={() => setDistributeMode(null)}
        onClearDiscard={() => setSelectedForDiscard(new Set())}
        onConfirmDiscard={handleConfirmDiscard}
        onSendDistribute={sendDistribute}
      />

      {/* ─── 座位布局(弧形) + 中央信息 ─── */}
      <div className={styles.seatingArea}>
        <SeatArcLayout
          view={view}
          orderedPlayers={orderedPlayers}
          perspectiveName={perspectiveName}
          currentPlayerName={currentPlayerName}
          selectedNeedsTarget={!!playRules && playRules.needsTarget}
          selectedTarget={selectedTarget}
          isTargetable={isTargetable}
          onTargetClick={handleTargetClick}
          onPerspectiveChange={onPerspectiveChange}
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
            isMyTurn={isMyTurn}
            canOperate={canOperate}
            isPerspectiveTurn={isPerspectiveTurn}
            skillActions={skillActions}
            onSkillAction={handleSkillAction}
          />
        </div>

        <div className={styles.handColumn}>
          <CountdownBar deadline={deadline} totalMs={pending?.totalMs ?? DEFAULT_COUNTDOWN_TOTAL_MS} />
          {/* 转化模式提示 + 取消选择 */}
          <div className={styles.handHeader}>
            <span className={styles.handTitle}>
              {perspectiveName} 的手牌 ({perspectiveHand.length})
              {perspectiveIdx !== view.viewer && <span className={styles.debugHint}> (调试视角)</span>}
              {transformMode && (
                <span className={cx(styles.debugHint, styles.transformHint)}>
                  ⚡ 转化模式:选1张{transformMode.wrapperName} · 源技能 {transformMode.skillId}
                </span>
              )}
            </span>
            {transformMode && (
              <button className={styles.cancelBtn} onClick={() => {
                setTransformMode(null);
                setSelectedCardId(null);
                setSelectedTarget(null);
              }}>
                取消转化
              </button>
            )}
            {!transformMode && selectedCardId && (
              <button className={styles.cancelBtn} onClick={() => { setSelectedCardId(null); setSelectedTarget(null); }}>
                取消选择
              </button>
            )}
          </div>
          {/* 操作面板:出牌/结束回合/目标提示 */}
          <div className={styles.actionBar}>
            {canOperate && isMyTurn && view.phase === '出牌' && transformMode && selectedCardId && (
              <button className={cx(styles.playBtn, !selectedTarget && styles.btnDisabled)} onClick={() => selectedTarget && handleTransformPlay(selectedTarget)} disabled={!selectedTarget}>
                使用{transformMode.wrapperName}{selectedTarget ? ` → ${selectedTarget}` : ' (请选目标)'}
              </button>
            )}
            {canOperate && isMyTurn && view.phase === '出牌' && !transformMode && selectedCardId && playButtonState && (
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
          {showTargetSelector && selectedCardId && (
            <TargetSelector
              view={view}
              perspectiveIdx={perspectiveIdx}
              selectedCardId={selectedCardId}
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
            {perspectiveHand.map((card, i) => {
              const isSelected = selectedCardId === card.id;
              const isDiscardSelected = selectedForDiscard.has(card.id);
              const canPlay = isMyTurn && canOperate;
              const isAwaiting = isMyAwaiting && (() => {
                const info = resolvePendingRespond(pending, skillActions);
                return !!info?.cardFilter?.(card);
              })();
              const canDiscardClick = isDiscardPhase && isPerspectiveAwaiting && canOperate;
              const isTransformMatch = transformMode !== null && transformMode.cardFilter(card);
              const isTransformActive = transformMode !== null && isMyTurn && canOperate;
              const isTransformDisabled = isTransformActive && !isTransformMatch;
              const isNew = anim.newCardIds.has(card.id);
              return (
                <HandCard
                  key={card.id}
                  card={card}
                  index={i}
                  totalHand={perspectiveHand.length}
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
                  onClick={() => handleCardClick(card)}
                />
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
