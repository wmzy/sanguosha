// src/client/components/GameView.tsx
// 完整游戏界面主组件。
//
// 职责:编排子组件 + 转发 hook 产出的状态/handler 到对应展示组件。
// 共享横切数据(view/perspectiveIdx/perspectiveName/isSpectating/canOperate/
// currentPlayerName/skillActions/send)经 GameViewCtx 一次性下发(见 GameViewCtx.tsx),
// 子组件用 useGameView() 取用;本编排层自己仍用本地变量,不消费自己的 context。
// 展示逻辑全部委托给子组件(GameHeader/OverlaysLayer/AwaitingPrompt/PlayPhasePrompt/
// SeatArcLayout/ZoneInfoBar/HeaderToolbar/CenterActionBar/HandArea/PlayerCardLarge)。
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
import { useState, useCallback, useRef, useEffect, useMemo, memo, type ReactNode } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView as EngineGameView, Card, Json, ViewEvent } from '../../engine/types';
import { getAtomDef } from '../../engine/core/atom';
import { CountdownBar } from './CountdownBar';
import { DEFAULT_COUNTDOWN_TOTAL_MS } from '../hooks/useCountdown';
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
import { HeaderToolbar } from './HeaderToolbar';
import { CenterActionBar } from './CenterActionBar';
import { HandArea } from './HandArea';
import { CancelButton } from './CancelButton';
import { EquipColumn } from './EquipColumn';
import { InfoDock } from './InfoDock';
import { PlayHistoryStrip } from './PlayHistoryStrip';
import { GameViewProvider, type GameViewCtxValue } from './GameViewCtx';
import {
  canShowCancelSelectionButton,
  canShowEndTurnButton,
  findUseActionForCard,
  hasUseEntry,
  isActiveAction,
} from '../utils/gameViewHelpers';
import { displaySkillName } from '../utils/skillDisplay';

// ─── 抽取的 hooks ───
import { useAnimationState } from '../hooks/useAnimationState';
import { useCardMoveAnimation } from '../hooks/useCardMoveAnimation';
import { useSkillActions } from '../hooks/useSkillActions';
import { usePendingState } from '../hooks/usePendingState';
import { useCharSelect } from '../hooks/useCharSelect';
import { useSeatOrder } from '../hooks/useSeatOrder';
import { useHandReorder } from '../hooks/useHandReorder';
import { usePlayInteraction } from '../hooks/usePlayInteraction';
import { useHotkeys } from '../hooks/useHotkeys';
import { useProcessingPicks } from '../hooks/useProcessingPicks';
import { usePlayHistory } from '../hooks/usePlayHistory';
import { useSoundPlayback } from '../hooks/useSoundPlayback';
import { useVfxPlayback } from '../hooks/useVfxPlayback';

import { VfxLayer } from './VfxLayer';
import { useAutoSkipPrefs } from '../hooks/useAutoSkipPrefs';
import { useAutoSkip } from '../hooks/useAutoSkip';

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
  /** 待播事件队列积压数(来自 useEventPlayback;>1 时 EventBanner 显示「+N 排队中」角标)。
   *  回放等无播放队列的场景不传。 */
  pendingCount?: number;
  /** 一键清空事件播放积压(横幅角标上的 ⏭,走 useEventPlayback.skipAll 对齐最新事件)。 */
  onSkipEvents?: () => void;
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
  /** 游戏中已断线的座次集合(view player index),座位卡据此显示离线角标。
   *  正式多人模式由 useMultiplayerRoom 维护;debug/回放模式不传(默认无离线标识)。 */
  disconnectedSeats?: Set<number>;
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
  pendingCount,
  onSkipEvents,
  readOnly = false,
  chatMessages,
  chatConfig,
  onSendChat,
  disconnectedSeats,
}: Props) {
  // perspectiveIdx 必须是有效座次索引。旁观者(无授权 viewer=-1)或越界时回退到座次 0,
  // 避免 view.players[perspectiveIdx] 为 undefined 导致渲染崩溃。
  // 旁观者看不到任何手牌(buildView 按原始 viewer=-1 过滤 hand),仅借用座次 0 做展示视角。
  const perspectiveIdx =
    view.viewer >= 0 && view.viewer < view.players.length ? view.viewer : 0;
  // 旁观者公开视图(viewer<0):看不到任何手牌,底栏借用座次 0 仅做展示视角。
  const isSpectating = view.viewer < 0;
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
  // 自动跳过偏好(策略跳过开关)
  const { prefs: autoSkipPrefs, toggleOptIn: toggleAutoSkip } = useAutoSkipPrefs();
  const { isCharSelectPending, charSelect, charSelectInProgress } = useCharSelect(
    view,
    perspectiveIdx,
  );
  const orderedPlayers = useSeatOrder(view, perspectiveIdx);
  const anim = useAnimationState(view, perspectiveIdx);
  useCardMoveAnimation(ingestedEvents ?? [], view);
  const playHistoryItems = usePlayHistory(ingestedEvents, view);
  // 音效播放:监听 ingested 立即批次,与视觉动作(手牌±/飞牌动画)同帧响应。
  // 氛围音效(回合/阶段)fire-and-forget;动作音效串行(间隔基于音频时长)避免叠音。
  useSoundPlayback(ingestedEvents);
  // Lottie 特效:同样监听 ingested 批次,按 effect.vfx 查 ResourceManager 播放 anim/{id}
  // (使用时事件的出牌动效由前端按 cardName + damageType 自行计算)
  const vfxItems = useVfxPlayback(ingestedEvents, view.cardMap);
  // ─── 粘性展示卡(火攻/界火计/义绝/蛊惑 等「展示手牌」) ───
  // 展示事件退出 banner 定时队列(useEventPlayback STICKY_REVEAL_TYPES),
  // 从 ingested 立即批次派生:最新一条展示事件常驻显示(翻入后停住不淡出)。
  // 玩家可同时操作(不门控任何 pending);本地动作提交(send)、展示结束事件或新展示到达即消失/替换。
  const [revealEvent, setRevealEvent] = useState<ViewEvent | null>(null);
  useEffect(() => {
    const reveals = (ingestedEvents ?? []).filter((e) => e.event.type === '展示');
    if (reveals.length > 0) {
      setRevealEvent(reveals[reveals.length - 1].event);
    }
    // 展示结束(引擎收尾信号,如火攻弃牌/不弃/超时后):事件驱动收卡。
    // 必须由事件驱动——旁观/回放/其他座次没有本地 send 动作,且「不弃/超时」
    // 路径后续再无任何事件可推断展示交互已收尾。本地 send 清除仍保留(双保险)。
    if ((ingestedEvents ?? []).some((e) => e.event.type === '展示结束')) {
      setRevealEvent(null);
    }
  }, [ingestedEvents]);

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

  // 发送 action(出牌交互状态机共享的底层函数)。
  // 所有玩家动作(出牌/弃牌/技能/skip/结束回合)的唯一出口——在此清除粘性展示卡:
  // 火攻等「展示手牌」常驻显示到玩家做出下一个操作为止,操作即取消(用户看完即决策)。
  const send = useCallback(
    (
      skillId: string,
      actionType: string,
      params: Record<string, Json>,
      preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>,
    ) => {
      setRevealEvent(null);
      onAction({ skillId, actionType, ownerId: perspectiveIdx, params, preceding });
    },
    [onAction, perspectiveIdx],
  );

  // ─── 出牌交互状态机(已抽出到 usePlayInteraction) ───
  // 五谷丰登选牌展示增强:通过对 view 快照的 diff 推导被选走的牌,标注选牌者
  const processingPicks = useProcessingPicks(view);

  // 自动跳过决策(无法响应/策略跳过时代发 skip)。需在 send 定义后调用。
  useAutoSkip({
    view, perspectiveIdx, skillActions, pendingRespondInfo, prefs: autoSkipPrefs,
    canOperate, isPerspectiveAwaiting, markBroadcastSkipped, broadcastKey, send,
  });

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
    activeDistribute,
    isDistributeActive,
    distSelected,
    distTargetName,
    selectedActive,
    playButtonState,
    selectedRespondCardId,
    respondTargetName,
    respondNeedsTarget,
    respondTargetReady,
    altActions,
    playRules,
    handleCardClick,
    handlePlayCard,
    handleTargetClick,
    handleSkillAction,
    isKillRespondContext,
    handleRespond,
    handlePlayRespond,
    handleEndTurn,
    isTargetable,
    cancelTransform,
    cancelSelection,
  } = play;

  const isMyAwaiting = isPerspectiveAwaiting && canOperate;
  // 广播型 pending(无懈可击等)当前视角已点「不回应」:本地标记跳过,
  // 隐藏自己的倒计时和「不回应」按钮(广播型 pending 仍在,其他座次照常显示)。
  const broadcastSkipped = pendingTargetIdx < 0 && skippedBroadcast.has(broadcastKey);

  // ─── 手牌可选性判定(渲染循环与数字键快捷键共用)───
  // 与点击置灰严格同源:自由出牌 canPlay(无 use 入口/未激活的牌置灰)、respond 回应
  // isAwaiting(cardFilter 排除的牌置灰)、弃牌 canDiscardClick(整手牌可选)。
  // 数字键 1-9 复用这三个判定,保证「点击置灰的牌数字键也无效果」。
  const canDiscardClick = isDiscardPhase && isPerspectiveAwaiting && canOperate;
  // canPlay 要求该牌有主动 use 入口,且(若有匹配的 use action)当前激活。
  // 闪/无懈可击等 timing='生效前' 的纯回应牌无主动 use 入口(hasUseEntry=false),
  // 在出牌阶段不可选——与 enumeratePlayActions 的 `if (!action) continue` 对齐。
  // useAction 为 undefined 时(如 useSkillActions 异步注册间隙/视角切换)乐观放行,
  // 避免手牌全灰闪烁;hasUseEntry 基于 CardEffect 注册表给出稳定判定。
  const canPlayHandCard = useCallback(
    (card: Card) => {
      const useAction = findUseActionForCard(skillActions, card);
      return (
        isMyTurn &&
        canOperate &&
        hasUseEntry(card) &&
        (!useAction || isActiveAction(useAction, { view, perspectiveIdx }))
      );
    },
    [isMyTurn, canOperate, skillActions, view, perspectiveIdx],
  );
  const isRespondableCard = useCallback(
    (card: Card) =>
      !isDistributeActive && isMyAwaiting && !!pendingRespondInfo?.cardFilter?.(card),
    [isDistributeActive, isMyAwaiting, pendingRespondInfo],
  );

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
  // 同源门控倒计时条(底部操作坞 + 座位弧 suppressCountdown):flip 期间倒计时已扣掉动画时长
  // 但 prompt 还没出现,二者不同步;flip 结束后倒计时与 prompt 同时出现,显示真实剩余时间。
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
  const isRespondPending =
    isMyAwaiting &&
    !isDiscardPhase &&
    !broadcastSkipped &&
    (pending?.prompt?.type === 'useCard' || pending?.prompt?.type === 'useCardAndTarget');
  const showCenterActionBar =
    isRespondPending ||
    (canOperate && !!selectedActive && !!transformMode) ||
    (canOperate && !!selectedActive && !transformMode && !!selectedCardId && !!playButtonState) ||
    (canOperate && !transformMode && !!selectedCardId && altActions.length > 0) ||
    (!transformMode && showCancelSelection) ||
    showEndTurn ||
    (canOperate && isDiscardPhase && isPerspectiveAwaiting) ||
    (canOperate && isDistributeActive && !!activeDistribute) ||
    (!!selectedCardId && !!selectedTarget && canOperate && isMyTurn);

  // ─── 键盘快捷键 ───
  // 语义与 actionBar 各按钮的 enabled 条件严格同源(复用同一批派生布尔量),
  // 保证「按钮能点时快捷键才生效」。回放(readOnly)不注册任何快捷键:传空表即可,
  // hook 内部无条件挂载,与 hooks 规则兼容。handlers 每次渲染重建闭包捕获最新状态,
  // useHotkeys 用 ref 读取,无需担心重挂。
  useHotkeys(
    readOnly
      ? {}
      : {
          // Enter:respond 窗口优先于出牌窗口(同时存在时回应询问更紧急)
          enter: () => {
            if (isRespondPending) {
              if (selectedRespondCardId && respondTargetReady) handlePlayRespond();
            } else if (playButtonState?.canPlay) {
              handlePlayCard();
            }
          },
          // Esc:转化模式最深,先退转化;其次取消已选牌
          escape: () => {
            if (transformMode) cancelTransform();
            else if (showCancelSelection) cancelSelection();
          },
          // Space:不回应。preventDefault 阻止页面滚动(空格默认滚动行为)
          space: (e) => {
            if (isRespondPending) {
              e.preventDefault();
              handleRespond();
            }
          },
          // E:结束回合(仅按钮可见时,即轮到本视角出牌且无 pending)
          e: () => {
            if (showEndTurn) handleEndTurn();
          },
          // 1-9:选第 n 张手牌,三个窗口与点击走同一 handleCardClick(toggle 逻辑唯一):
          //   自由出牌(仅出牌阶段无 pending,置灰牌无效)、respond 回应(filter 排除无效)、
          //   弃牌多选。转化/distribute 模式的候选校验由 handleCardClick 内部分支兜底,
          //   键盘路径不绕过任何选中校验。输入框焦点过滤由 useHotkeys 统一处理。
          ...Object.fromEntries(
            [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
              (n): [string, () => void] => [
                String(n),
                () => {
                  const card = perspectiveHand[n - 1];
                  if (!card) return;
                  const inFreePlay = isMyTurn && view.phase === '出牌' && !pending;
                  const transformActive = !!transformMode && (isMyTurn || isKillRespondContext);
                  if (
                    (inFreePlay && canPlayHandCard(card)) ||
                    isRespondableCard(card) ||
                    canDiscardClick ||
                    transformActive ||
                    isDistributeActive
                  ) {
                    handleCardClick(card);
                  }
                },
              ],
            ),
          ),
        },
  );

  // 底栏自己的大卡是否可作为目标（铁索连环含自己）。与 SeatArcLayout 的
  // selectedNeedsTarget 同源：选目标阶段 + 自己可被选（allowSelf/selfTarget）。
  const selfInTargetMode =
    (!!playRules && playRules.needsTarget) ||
    (isDistributeActive && !!activeDistribute?.externalTargetSelection) ||
    respondNeedsTarget;
  const selfTargetable = canOperate && selfInTargetMode && isTargetable(perspectiveIdx);
  const selfSelectedAsTarget =
    isDistributeActive && activeDistribute?.externalTargetSelection
      ? distTargetName === perspectiveName
      : playRules?.multiTarget
        ? selectedMultiTargets.includes(perspectiveName)
        : selectedTarget === perspectiveName;

  // ─── 共享数据 Context(消除编排层重复透传)───
  // 全树共享、随 view/技能注册变化的横切数据一次性下发;子组件经 useGameView() 取用,
  // 专属数据(pending/动画/交互 handler 等)仍走 props。编排层自己继续用本地变量,
  // 不消费自己的 context。value 必须 useMemo:每次 view 变化产生新引用是预期行为
  // (消费壳随之重渲染,但内部 memo impl 的 comparator 保证重活儿仍被拦截)。
  const ctxValue = useMemo<GameViewCtxValue>(
    () => ({
      view,
      perspectiveIdx,
      perspectiveName,
      isSpectating,
      canOperate,
      currentPlayerName,
      skillActions,
      send,
    }),
    [view, perspectiveIdx, perspectiveName, isSpectating, canOperate, currentPlayerName, skillActions, send],
  );

  return (
    <GameViewProvider value={ctxValue}>
    <div className={styles.pageRoot}>
      <OverlaysLayer
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
          animTurnVersion={anim.turnVersion}
          animPhaseVersion={anim.phaseVersion}
          currentPlayerName={currentPlayerName}
          headerSlot={
            <HeaderToolbar prefs={autoSkipPrefs} onToggle={toggleAutoSkip}>
              {headerSlot}
            </HeaderToolbar>
          }
        />
      </DevProfiler>

      {/* ─── 主内容:战场区 + 右侧边栏 ─── */}
      <div className={styles.mainContent}>
        <div className={styles.battleField}>
          {/* ─── 事件横幅(延时展示,非阻塞)+ 积压角标/跳过 + 粘性展示卡(常驻至操作) ─── */}
          <EventBanner
            current={currentEvent ?? null}
            reveal={revealEvent}
            pendingCount={pendingCount}
            onSkip={onSkipEvents}
          />
          {/* ─── 动作浮层+箭头(谁对谁用什么牌) ─── */}
          <ActionOverlay current={currentEvent ?? null} />

          {/* ─── 座位环 + 中央牌堆 + 底部操作坞 ─── */}
          <div className={styles.seatingArea}>
            <DevProfiler id="SeatArcLayout">
              <SeatArcLayout
                orderedPlayers={orderedPlayers}
                currentPlayerName={currentPlayerName}
                selectedNeedsTarget={
                  (!!playRules && playRules.needsTarget) ||
                  (isDistributeActive && !!activeDistribute?.externalTargetSelection) ||
                  respondNeedsTarget
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
                        : respondNeedsTarget
                          ? respondTargetName
                            ? [respondTargetName]
                            : []
                          : selectedTarget
                            ? [selectedTarget]
                            : []
                }
                isTargetable={isTargetable}
                onTargetClick={handleTargetClick}
                onSeatDoubleClick={onSeatDoubleClick}
                damageFlashIndices={anim.damageFlashIndices}
                healFlashIndices={anim.healFlashIndices}
                hpChangeNumbers={anim.hpChangeNumbers}
                turnVersion={anim.turnVersion}
                disconnectedSeats={disconnectedSeats}
                suppressCountdown={isPlayingFlipAnim}
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
                          perspectiveHand={perspectiveHand}
                          pendingRespondInfo={pendingRespondInfo}
                          broadcastKey={broadcastKey}
                          skippedBroadcast={skippedBroadcast}
                          processingPicks={processingPicks}
                          autoSkipPrefs={autoSkipPrefs}
                          onToggleAutoSkip={toggleAutoSkip}
                        />
                      )}
                    <PlayPhasePrompt
                      currentPlayerName={currentPlayerName}
                      isPerspectiveTurn={isPerspectiveTurn}
                      isPerspectiveAwaiting={isPerspectiveAwaiting}
                      isDiscardPhase={isDiscardPhase}
                      isMyTurn={isMyTurn}
                      selectedCardId={selectedCardId}
                      selectedTarget={selectedTarget}
                      discardMin={discardMin}
                      discardMax={discardMax}
                      selectedForDiscard={selectedForDiscard}
                    />

                    {/* 倒计时条与 AwaitingPrompt 同步门控:翻牌动画期间不渲染,
                        动画结束后与 prompt 同时出现且为真实剩余时间。
                        不伪造暂停——服务端超时按真实时钟走,deadline 不可改。 */}
                    {(isPerspectiveAwaiting || (isMyTurn && view.phase === '出牌')) &&
                      !broadcastSkipped &&
                      !readOnly &&
                      !isPlayingFlipAnim && (
                        <CountdownBar
                          deadline={deadline}
                          totalMs={deadlineTotalMs || DEFAULT_COUNTDOWN_TOTAL_MS}
                        />
                      )}

                    {/* 转化模式(丈八蛇矛等多选转化)提示行:转化模式是另一套交互,
                        「取消选择」已移至 actionBar 与出牌按钮同行,这里只保留转化提示 */}
                    {transformMode && (
                      <div className={styles.handHeader}>
                        <span className={cx(styles.debugHint, styles.transformHint)}>
                          ⚡ 转化模式:选
                          {transformMode.minCards > 1 ? `${transformMode.minCards}张` : '1张'}
                          {transformMode.wrapperName}
                          {transformMode.minCards > 1
                            ? `(${transformMode.selectedCardIds.length}/${transformMode.maxCards})`
                            : ''}{' '}
                          · 源技能 {displaySkillName(transformMode.skillId)}
                        </span>
                        <CancelButton label="取消转化" onClick={cancelTransform} />
                      </div>
                    )}

                    {showCenterActionBar && (
                      <CenterActionBar
                        play={play}
                        pending={pending}
                        isRespondPending={isRespondPending}
                        showCancelSelection={showCancelSelection}
                        showEndTurn={showEndTurn}
                        isMyTurn={isMyTurn}
                        isDiscardPhase={isDiscardPhase}
                        isPerspectiveAwaiting={isPerspectiveAwaiting}
                        discardMin={discardMin}
                        discardMax={discardMax}
                      />
                    )}
                  </>
                }
              />
            </DevProfiler>

            {/* 中央:牌堆/处理区 + 出牌历史条 */}
            <div className={styles.centerTable}>
              <ZoneInfoBar />
              <PlayHistoryStrip items={playHistoryItems} />
            </div>
          </div>
        </div>

        {/* 右侧边栏:日志/聊天 */}
        <div className={styles.rightSidebar}>
          <InfoDock
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
          onSkillAction={handleSkillAction}
          distCandidateEquipIds={activeDistribute ? new Set(activeDistribute.cardIds) : null}
          distSelectedEquipIds={distSelected}
          isDistributeActive={isDistributeActive}
          onEquipCardClick={handleEquipCardClick}
        />

        <HandArea
          play={play}
          phase={view.phase}
          isSpectating={isSpectating}
          perspectiveHand={perspectiveHand}
          spectatorHandCount={perspectivePlayer.handCount}
          handListRef={handListRef}
          orderedHand={orderedHand}
          handleDragStart={handleDragStart}
          handleDrop={handleDrop}
          canPlayHandCard={canPlayHandCard}
          isRespondableCard={isRespondableCard}
          canDiscardClick={canDiscardClick}
          isMyAwaiting={isMyAwaiting}
          isMyTurn={isMyTurn}
          onReorderHand={onReorderHand}
        />

        <div
          className={cx(
            styles.playerCardLarge,
            isPerspectiveTurn && styles.playerCardTurn,
            anim.damageFlashIndices.has(perspectiveIdx) && styles.seatShaking,
            anim.damageFlashIndices.has(perspectiveIdx) && styles.seatDamageOverlay,
            anim.healFlashIndices.has(perspectiveIdx) && styles.seatHealOverlay,
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
              viewer={view.viewer}
              damageFlashIndices={anim.damageFlashIndices}
              healFlashIndices={anim.healFlashIndices}
              hpChange={anim.hpChangeNumbers.get(perspectiveIdx)}
              isPerspectiveTurn={isPerspectiveTurn}
              onSkillAction={handleSkillAction}
            />
          </DevProfiler>
        </div>
      </div>

      {/* ─── Lottie 特效层(顶层 fixed,不拦截交互)─── */}
      <VfxLayer items={vfxItems} view={view} />
    </div>
    </GameViewProvider>
  );
}

/**
 * React.memo:顶层组件在 view 未变时跳过重渲染。
 * headerSlot/overlaySlot 是上层 JSX,引用每次变化——比较器中按引用比较,
 * 实际拦截发生在子组件层(PlayerSeatView/HandCard 等的自定义 comparator)。
 */
export const GameViewComponent = memo(GameViewComponentImpl);
