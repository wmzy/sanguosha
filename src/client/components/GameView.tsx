// src/client/components/GameView.tsx
// 完整游戏界面主组件。
//
// 职责:状态管理 + 事件 handler + 编排子组件。
// 展示逻辑全部委托给子组件(GameHeader/OverlaysLayer/AwaitingPrompt/PlayPhasePrompt/
// TargetSelector/SeatArcLayout/ZoneInfoBar/HandCard/PlayerCardLarge)。
// 状态派生委托给 hooks(useSkillActions/usePendingState/useCharSelect/useSeatOrder/useAnimationState)。
//
// 不感知视角切换:本组件只渲染 view.viewer 这一个视角的游戏画面。
//   正式模式:上层直接传入 view,viewer 就是当前玩家。
//   debug 模式:上层(DebugLobby)管理多连接 + 视角切换,把当前视角连接的 view 传入,
//   并通过 headerSlot/overlaySlot 注入视角控制 UI。切换视图、自动跟随、代打等逻辑
//   均在上层,本组件不可见。
//
// 布局: GameHeader → 提示区 → 座位弧形(其他玩家) → [左:角色大卡 | 右:倒计时+操作+目标+手牌] → 日志
import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView as EngineGameView, Card, Json, DistributePrompt } from '../../engine/types';
import { CountdownBar, DEFAULT_COUNTDOWN_TOTAL_MS } from './CountdownBar';
import { PlayerCardLarge } from './PlayerCardLarge';
import { GameLog } from './GameLog';
import { createCardFlyAnimation } from '../utils/cardFlyAnimation';
import { resolvePendingRespond } from '../utils/pendingRespond';
import { buildPlayParams, derivePlayRules, findUseActionForCard, isActiveAction, resolveDistributeCardIds } from '../utils/gameViewHelpers';

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
  /** 整理手牌:重排顺序(不走 action,直接 mutate 后端 hand) */
  onReorderHand?: (order: string[]) => void;
  /** 双击其他座次卡片(通用 UI 事件;上层决定行为,如切换视角)。 */
  onSeatDoubleClick?: (index: number) => void;
  /** 顶部栏右侧插槽:上层渲染视角控制/退出等 debug UI。不提供则右侧为空。 */
  headerSlot?: ReactNode;
  /** 遮罩角落插槽:上层在选将/等待遮罩内渲染视角控制 UI。 */
  overlaySlot?: ReactNode;
}

/** 转化模式:点转化技能(武圣/丈八蛇矛)后进入此模式,匹配卡牌显示为转化后的牌
 *  单卡转化(minCards=1):选 1 张卡 → 选目标 → 提交(武圣)
 *  多卡转化(minCards>1):选 N 张卡 → 选目标 → 提交(丈八蛇矛=2) */
interface TransformMode {
  skillId: string;
  actionType: string;
  cardFilter: (c: Card) => boolean;
  wrapperName: string;
  /** 选牌数量范围(来自 cardFilter.min/max),单卡转化=1..1 */
  minCards: number;
  maxCards: number;
  /** 多卡模式下选中的卡 id 列表(单卡模式用 selectedCardId) */
  selectedCardIds: string[];
}

// ─── 主组件 ───
// 纯净的单视角组件:只渲染 view.viewer 的游戏画面,不感知视角切换。
//   正式模式:上层直接传入当前玩家的 view。
//   debug 模式:上层(DebugLobby)管理多连接和视角切换,把当前视角连接的 view 传入,
//   并通过 headerSlot/overlaySlot 注入视角控制 UI。
export function GameViewComponent({ view, onAction, onReorderHand, onSeatDoubleClick, headerSlot, overlaySlot }: Props) {
  const perspectiveIdx = view.viewer;
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedKillTarget, setSelectedKillTarget] = useState<string | null>(null);
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<string>>(new Set());
  const [transformMode, setTransformMode] = useState<TransformMode | null>(null);
  const [distributeMode, setDistributeMode] = useState<{ skillId: string; actionType: string; prompt: DistributePrompt } | null>(null);
  // distribute 选牌状态(主动技 + 被动遗计共用):驱动手牌区高亮
  const [distSelected, setDistSelected] = useState<Set<string>>(new Set());
  const [distAllocations, setDistAllocations] = useState<Array<{ target: number; cardIds: string[] }>>([]);
  // 仁德类(主动 allocate + externalTargetSelection):座位选的目标
  const [distTargetName, setDistTargetName] = useState<string | null>(null);
  const [showIdentityReveal, setShowIdentityReveal] = useState(() => !sessionStorage.getItem('sgs_identity_shown'));
  // 整理手牌:本地顺序状态(拖拽时实时更新,拖拽结束发 reorder_hand)
  // null = 用服务端顺序;非 null = 用本地重排顺序(需与服务端手牌集合一致)
  const [localHandOrder, setLocalHandOrder] = useState<string[] | null>(null);
  const dragSrcIdx = useRef<number | null>(null);
  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── 状态派生(hooks) ───
  const { skillActions } = useSkillActions(view, perspectiveIdx);
  const pendingState = usePendingState(view, perspectiveIdx);
  const { pending, pendingTargetIdx, isPerspectiveAwaiting, isDiscardPhase, discardMin, discardMax, skippedBroadcast, markBroadcastSkipped, deadline, deadlineTotalMs } = pendingState;
  const { isCharSelectPending, charSelect, charSelectInProgress } = useCharSelect(view, perspectiveIdx);
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

  // 整理手牌:本地顺序与服务端手牌集合一致性校验
  // 服务端手牌变化(摸/出/弃)时,如果 localHandOrder 不再是合法排列,自动重置
  const serverHandIds = perspectiveHand.map(c => c.id);
  const localOrderValid = localHandOrder !== null
    && localHandOrder.length === serverHandIds.length
    && serverHandIds.every(id => localHandOrder.includes(id));
  // orderedHand:本地顺序优先(拖拽实时预览),无效则用服务端顺序
  const orderedHand: Card[] = localOrderValid
    ? (localHandOrder!.map(id => perspectiveHand.find(c => c.id === id)).filter(Boolean) as Card[])
    : perspectiveHand;
  // 服务端已同步本地顺序时,清除本地状态(避免陈旧覆盖)
  useEffect(() => {
    if (localHandOrder && localOrderValid) {
      const serverOrder = perspectiveHand.map(c => c.id);
      const synced = serverOrder.length === localHandOrder.length
        && serverOrder.every((id, i) => id === localHandOrder[i]);
      if (synced) setLocalHandOrder(null);
    }
    // localOrderValid 为 false 时也清除(手牌集合已变)
    if (localHandOrder && !localOrderValid) setLocalHandOrder(null);
  }, [localHandOrder, localOrderValid, perspectiveHand]);

  // 拖拽重排:dragstart 记录源位置,dragover 阻止默认(允许 drop),drop 时重排
  const handleDragStart = useCallback((idx: number) => {
    dragSrcIdx.current = idx;
  }, []);
  const handleDrop = useCallback((targetIdx: number) => {
    const srcIdx = dragSrcIdx.current;
    dragSrcIdx.current = null;
    if (srcIdx === null || srcIdx === targetIdx) return;
    // 基于当前 orderedHand 重排
    const ids = orderedHand.map(c => c.id);
    const [moved] = ids.splice(srcIdx, 1);
    ids.splice(targetIdx, 0, moved);
    setLocalHandOrder(ids);
    // 去抖发送 reorder_hand(避免快速拖拽频繁发消息)
    if (onReorderHand) {
      if (reorderTimer.current) clearTimeout(reorderTimer.current);
      reorderTimer.current = setTimeout(() => {
        onReorderHand(ids);
        reorderTimer.current = null;
      }, 400);
    }
  }, [orderedHand, onReorderHand]);

  // 上层传入 perspective 即意味着该视角可操作(正式模式只传 viewer,
  // debug 模式上层保证视角合法性),故恒为 true。后续 handler 仅检查 isMyTurn/isPerspectiveAwaiting。
  const canOperate = true;
  const isMyAwaiting = isPerspectiveAwaiting && canOperate;

  // ─── distribute 上下文(主动技 + 被动遗计共用)───
  // 统一两个来源:distributeMode(仁德/制衡主动技)、pending.prompt.type==='distribute'(遗计被动)。
  // 二者都用手牌区选牌 + DistributeUI 提示/分配。
  const perspectiveEquipment = perspectivePlayer?.equipment ?? {};
  const activeDistribute = (() => {
    // 1. 主动技优先
    if (distributeMode) {
      const { skillId, actionType, prompt } = distributeMode;
      const cardIds = resolveDistributeCardIds(prompt, perspectiveHand, perspectiveEquipment);
      // 主动 allocate(仁德):目标由座位区点选,不走 DistributeUI 内部目标按钮
      const externalTargetSelection = (prompt.mode ?? 'allocate') === 'allocate';
      return { skillId, actionType, prompt, cardIds, externalTargetSelection };
    }
    // 2. 被动 distribute pending(遗计分配/贯石斧选牌)
    if (isMyAwaiting && pending && pending.prompt.type === 'distribute') {
      const info = resolvePendingRespond(pending, skillActions);
      const skillId = info?.skillId ?? '系统规则';
      const cardIds = resolveDistributeCardIds(pending.prompt, perspectiveHand, perspectiveEquipment);
      return { skillId, actionType: 'respond', prompt: pending.prompt, cardIds, externalTargetSelection: false };
    }
    return null;
  })();
  const isDistributeActive = activeDistribute !== null;

  // ─── state 重置 effects(切牌/切 pending 时清理) ───
  // 弃牌窗口出现/切换时清空已选
  useEffect(() => { setSelectedForDiscard(new Set()); }, [pending]);
  // distribute 上下文切换(主动技进入/退出 或 pending 变化)时清空选牌状态
  const distKey = activeDistribute ? `${activeDistribute.skillId}:${activeDistribute.actionType}:${activeDistribute.prompt.mode ?? 'allocate'}` : '';
  useEffect(() => {
    setDistSelected(new Set());
    setDistAllocations([]);
    setDistTargetName(null);
  }, [distKey]);
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

  /** distribute 选牌:切换某张牌的选中态(受 maxTotal 约束) */
  const handleDistToggle = useCallback((id: string) => {
    if (!activeDistribute) return;
    const maxTotal = activeDistribute.prompt.maxTotal ?? 99;
    setDistSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        if (n.size >= maxTotal) return prev;
        n.add(id);
      }
      return n;
    });
  }, [activeDistribute]);

  /** distribute allocate 模式:把当前 selected 分配给某目标 */
  const handleDistAllocate = useCallback((targetIdx: number) => {
    if (!activeDistribute) return;
    const maxPerTarget = activeDistribute.prompt.maxPerTarget ?? 99;
    if (distSelected.size === 0) return;
    setDistAllocations(prev => {
      const already = prev.filter(a => a.target === targetIdx).reduce((s, a) => s + a.cardIds.length, 0);
      if (already + distSelected.size > maxPerTarget) return prev;
      return [...prev, { target: targetIdx, cardIds: [...distSelected] }];
    });
    setDistSelected(new Set());
  }, [activeDistribute, distSelected]);

  /** distribute 提交(select → cardIds;allocate → allocation;
   *  仁德 externalTargetSelection → allocation=[{target:idx, cardIds:[...selected]}]) */
  const handleDistSubmit = useCallback(() => {
    if (!activeDistribute) return;
    const { skillId, actionType, prompt, externalTargetSelection } = activeDistribute;
    const mode = prompt.mode ?? 'allocate';
    const minTotal = prompt.minTotal ?? 1;
    if (mode === 'select') {
      const total = distSelected.size;
      if (total < minTotal) return;
      send(skillId, actionType, { cardIds: [...distSelected] });
    } else if (externalTargetSelection) {
      // 仁德:座位选目标 + 手牌多选 → 单目标 allocation
      if (distSelected.size < minTotal) return;
      if (!distTargetName) return;
      const idx = nameToIndex(distTargetName);
      if (idx < 0) return;
      send(skillId, actionType, { allocation: [{ target: idx, cardIds: [...distSelected] }] });
    } else {
      const total = distAllocations.flatMap(a => a.cardIds).length;
      if (total < minTotal) return;
      send(skillId, actionType, { allocation: distAllocations });
    }
    setDistSelected(new Set());
    setDistAllocations([]);
    setDistTargetName(null);
    setDistributeMode(null);
  }, [activeDistribute, distSelected, distAllocations, distTargetName, send]);

  /** distribute 清空选牌 + 分配 */
  const handleDistClear = useCallback(() => {
    setDistSelected(new Set());
    setDistAllocations([]);
    setDistTargetName(null);
  }, []);

  // ─── 选中的牌 ───
  const selectedCard = selectedCardId ? perspectiveHand.find(c => c.id === selectedCardId) ?? null : null;

  /** 判断目标 i 是否可被选中(距离/范围检查)。
   *  由选中卡 use action 的 targetFilter.filter 驱动(杀/顺手牵羊等声明了距离 filter)。
   *  无 filter 时恒可选(距离规则已后端 validate 兜底)。 */
  function isTargetable(i: number): boolean {
    // 仁德 externalTargetSelection:允许所有存活非自己玩家(无距离限制)
    if (isDistributeActive && activeDistribute?.externalTargetSelection) {
      if (!activeDistribute.prompt.allowSelf && i === perspectiveIdx) return false;
      return view.players[i]?.alive === true;
    }
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
    // use action 由 filter-based 查找得到(见下方 selectedUseAction 派生)
    if (!selectedUseAction) return;
    const rules = derivePlayRules(selectedTargetFilter, selectedUseAction.prompt.type === 'useCardAndTarget' && selectedUseAction.prompt.selfTarget);
    const params = buildPlayParams(view.players, perspectiveIdx, card, rules, selectedTarget, selectedKillTarget);
    if (params === null) return;
    // ─── 出牌飞行动画:在 card 消失前捕获位置,生成浮动元素 ───
    const cardEl = handListRef.current?.querySelector(`[data-card-id="${card.id}"]`) as HTMLElement | null;
    if (cardEl) {
      createCardFlyAnimation(cardEl, card);
    }
    send(selectedUseAction.skillId, 'use', params);
  }

  function handleTargetClick(name: string) {
    const idx = view.players.findIndex(p => p.name === name);
    if (idx >= 0 && !isTargetable(idx)) return; // 距离外,禁止选中
    // 仁德 externalTargetSelection 模式:座位选目标写入 distTargetName
    if (isDistributeActive && activeDistribute?.externalTargetSelection) {
      // allowSelf=false(仁德)则禁止选自己
      if (!activeDistribute.prompt.allowSelf && idx === perspectiveIdx) return;
      setDistTargetName(distTargetName === name ? null : name);
      return;
    }
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
        // 转化技能(如武圣/丈八蛇矛):进入转化模式,用户从手牌中选匹配卡牌后再选目标
        if (action.transform) {
          if (prompt.cardFilter?.filter) {
            const sample = perspectiveHand.find(c => prompt.cardFilter!.filter!(c));
            const wrapperName = sample
              ? action.transform(sample).name
              : action.skillId;
            const minCards = prompt.cardFilter.min ?? 1;
            const maxCards = prompt.cardFilter.max ?? 1;
            setTransformMode({ skillId, actionType, cardFilter: prompt.cardFilter.filter, wrapperName, minCards, maxCards, selectedCardIds: [] });
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

  // ─── 转化模式:选完目标后,提交 preceding=[transform] + 转化后的牌.use ──
  function handleTransformPlay(targetName: string) {
    if (!transformMode) return;
    const idx = nameToIndex(targetName);
    if (idx < 0) return;

    if (transformMode.minCards > 1) {
      // 多卡转化(丈八蛇矛):提交 preceding params.cardIds=[id1,id2,...] +
      // 主 action cardId = ${id1}#${id2}#...#skillId
      const ids = transformMode.selectedCardIds;
      if (ids.length < transformMode.minCards || ids.length > transformMode.maxCards) return;
      const shadowCardId = `${ids.join('#')}#${transformMode.skillId}`;
      send(transformMode.wrapperName, 'use', { cardId: shadowCardId, targets: [idx] }, [{
        skillId: transformMode.skillId,
        actionType: transformMode.actionType,
        params: { cardIds: ids },
      }]);
    } else {
      // 单卡转化(武圣)
      if (!selectedCardId) return;
      const targetCard = perspectiveHand.find(c => c.id === selectedCardId);
      if (!targetCard) return;
      const shadowCardId = `${selectedCardId}#${transformMode.skillId}`;
      send(transformMode.wrapperName, 'use', { cardId: shadowCardId, targets: [idx] }, [{
        skillId: transformMode.skillId,
        actionType: transformMode.actionType,
        params: { cardId: selectedCardId },
      }]);
    }
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
    // distribute 选牌(主动技仁德/制衡 + 被动遗计):仅候选牌可点
    if (isDistributeActive && activeDistribute) {
      const candidateSet = new Set(activeDistribute.cardIds);
      if (!candidateSet.has(card.id)) return;
      handleDistToggle(card.id);
      return;
    }
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
    // 转化模式(如武圣/丈八蛇矛):只允许点击匹配的卡牌作为"被转化的原牌"
    if (transformMode && isMyTurn && canOperate) {
      if (!transformMode.cardFilter(card)) return;
      if (transformMode.minCards > 1) {
        // 多卡转化(丈八蛇矛):toggle 选中,受 maxCards 约束
        setSelectedCardId(null);
        setTransformMode(prev => prev && {
          ...prev,
          selectedCardIds: prev.selectedCardIds.includes(card.id)
            ? prev.selectedCardIds.filter(id => id !== card.id)
            : (prev.selectedCardIds.length < prev.maxCards ? [...prev.selectedCardIds, card.id] : prev.selectedCardIds),
        });
        setSelectedTarget(null);
      } else {
        // 单卡转化(武圣)
        if (selectedCardId === card.id) {
          setSelectedCardId(null);
          setSelectedTarget(null);
        } else {
          setSelectedCardId(card.id);
          setSelectedTarget(null);
        }
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

  // ─── 选中卡的 use action(filter-based 查找)───
  // action 声明即真相:技能 defineAction('use') 时声明 cardFilter 表达"我适用于哪些牌",
  // 这里遍历当前视角玩家的 use action 跑 filter 匹配选中卡,而非用 card.name→skillId 反查。
  // 装备牌的 use action 以 skillId '装备通用' 注册但声明 cardFilter=装备牌,自然被匹配到。
  // 转化模式(武圣红牌当杀)用 wrapperName 对应牌的 use action(如"杀")。
  const selectedUseAction = (() => {
    if (!selectedCard) return undefined;
    if (transformMode) {
      // 转化模式:用转化后的牌名(杀)去匹配 use action
      return skillActions.find(a => a.actionType === 'use' && a.skillId === transformMode.wrapperName);
    }
    return findUseActionForCard(skillActions, selectedCard);
  })();
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

  // 是否需要渲染目标选择面板:选中卡的 use action 处于激活态 + 需要目标且非 selfTarget。
  // 激活态由 action 声明决定(缺省=出牌阶段+自己回合+无 pending),不再硬编码分支。
  const playRules = selectedUseAction
    ? derivePlayRules(selectedTargetFilter, selectedUseAction.prompt.type === 'useCardAndTarget' && selectedUseAction.prompt.selfTarget)
    : null;
  const selectedActive = selectedUseAction ? isActiveAction(selectedUseAction, { view, perspectiveIdx }) : false;
  // 多卡转化模式(丈八蛇矛):选够 N 张后即可选目标(selectedCardId 为 null)
  const multiTransformReady = !!(transformMode && transformMode.minCards > 1
    && transformMode.selectedCardIds.length >= transformMode.minCards
    && transformMode.selectedCardIds.length <= transformMode.maxCards);
  const showTargetSelector = canOperate && selectedActive && !!playRules && playRules.needsTarget
    && (selectedCardId !== null || multiTransformReady);

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
            onClearDiscard={() => setSelectedForDiscard(new Set())}
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
                  <button className={styles.cancelBtn} onClick={() => setDistributeMode(null)}>取消</button>
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
            {orderedHand.map((card, i) => {
              const isSelected = selectedCardId === card.id
                || !!(transformMode && transformMode.minCards > 1 && transformMode.selectedCardIds.includes(card.id));
              const isDiscardSelected = selectedForDiscard.has(card.id);
              const canPlay = isMyTurn && canOperate;
              // distribute 激活时不走 useCard 回应高亮(避免遗计 pending 双高亮)
              const isAwaiting = !isDistributeActive && isMyAwaiting && (() => {
                const info = resolvePendingRespond(pending, skillActions);
                return !!info?.cardFilter?.(card);
              })();
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
