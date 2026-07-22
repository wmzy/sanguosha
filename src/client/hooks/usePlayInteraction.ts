// src/client/hooks/usePlayInteraction.ts
// 出牌交互状态机 hook。从 GameView.tsx 抽出。
//
// 职责:管理所有"出牌/回应/弃牌/转化/distribute"交互状态及其 handler:
//   - 选中的牌(selectedCardId)、目标(selectedTarget/selectedKillTarget)
//   - 弃牌选中(selectedForDiscard)
//   - 转化模式(transformMode:武圣/丈八蛇矛)
//   - distribute 选中/分配(distSelected/distAllocations/distTargetName)
//   - 出牌飞行动画触发(通过 onCardFly 回调)
// 以及由这些状态派生的 UI 量:
//   - selectedUseAction / selectedTargetFilter / playButtonState 等
//
// 不管理:手牌拖拽重排(useHandReorder)、视角切换、WS 连接。

import { useState, useCallback, useEffect, useMemo, type RefObject } from 'react';
import type { Card, GameView, Json, DistributePrompt, PendingView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import type { PendingRespondInfo } from '../utils/pendingRespond';

import {
  buildPlayParams,
  derivePlayRules,
  findUseActionForCard,
  findAltActionsForCard,
  isActiveAction,
  isFreePlayWindow,
  resolveDistributeCardIds,
} from '../utils/gameViewHelpers';
import { createCardFlyAnimation } from '../utils/cardFlyAnimation';

/** 转化模式:点转化技能(武圣/丈八蛇矛)后进入此模式,匹配卡牌显示为转化后的牌 */
export interface TransformMode {
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

/** distribute 上下文(主动技 + 被动遗计统一) */
export interface ActiveDistribute {
  skillId: string;
  actionType: string;
  prompt: DistributePrompt;
  cardIds: string[];
  externalTargetSelection: boolean;
}

export interface PlayInteractionParams {
  view: GameView;
  perspectiveIdx: number;
  perspectiveHand: Card[];
  /** 当前视角玩家的技能 actions */
  skillActions: SkillActionDef[];
  /** pending 原始对象(可能 null) */
  pending: PendingView | null;
  /** 是否弃牌窗口 */
  isDiscardPhase: boolean;
  /** 弃牌窗口最少/最多张数 */
  discardMin: number;
  discardMax: number;
  /** 是否当前视角在等待回应(阻塞型) */
  isPerspectiveAwaiting: boolean;
  /** 已 resolve 的 respond 信息(usePendingState memo 后传入) */
  pendingRespondInfo: PendingRespondInfo | null;
  /** 广播型 pending 的去重 key */
  broadcastKey: string;
  /** 广播跳过标记函数(usePendingState 提供) */
  markBroadcastSkipped: (key: string) => void;
  /** pending target 座次 */
  pendingTargetIdx: number;
  /** 发送 action 的底层函数(GameView 的 send) */
  send: (
    skillId: string,
    actionType: string,
    params: Record<string, Json>,
    preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>,
  ) => void;
  /** 手牌列表容器 ref(出牌飞行动画定位用) */
  handListRef: RefObject<HTMLDivElement | null>;
}

export interface PlayInteractionResult {
  // ─── 选中的牌/目标 ───
  selectedCardId: string | null;
  selectedTarget: string | null;
  selectedKillTarget: string | null;
  selectedForDiscard: Set<string>;
  // ─── 转化模式 ───
  transformMode: TransformMode | null;
  // ─── distribute ───
  distributeMode: { skillId: string; actionType: string; prompt: DistributePrompt } | null;
  activeDistribute: ActiveDistribute | null;
  isDistributeActive: boolean;
  distSelected: Set<string>;
  distAllocations: Array<{ target: number; cardIds: string[] }>;
  distTargetName: string | null;
  /**
   * distribute 外部候选牌:候选 id 中不在当前视角手牌/装备区里的牌。
   * 这些牌(牌堆顶/目标手牌/目标装备)必须单独渲染,因为手牌区/装备区的
   * 候选高亮逻辑无法覆盖它们(观星/界观星/界恂恂/界称象/界破军/界镇军)。
   * 牌内容通过 view.cardMap[id] 查得(全量标准牌已预填充)。
   */
  distExternalCandidates: Card[];
  // ─── 派生量 ───
  selectedCard: Card | null;
  selectedUseAction: SkillActionDef | undefined;
  selectedTargetFilter: import('../../engine/types').TargetFilter | null;
  playRules: import('../utils/gameViewHelpers').PlayRules | null;
  selectedActive: boolean;
  playButtonState: { canPlay: boolean; targetLabel: string } | null;
  /** 选中牌的可用替代动作(如铁索连环·重铸),均已 active */
  altActions: SkillActionDef[];
  // ─── handlers ───
  handleCardClick: (card: Card) => void;
  handlePlayCard: () => void;
  handleTargetClick: (name: string) => void;
  handleSkillAction: (action: SkillActionDef) => void;
  handleTransformPlay: (targetName: string) => void;
  handleRespond: (cardId?: string) => void;
  handleEndTurn: () => void;
  handleConfirmDiscard: () => void;
  isTargetable: (i: number) => boolean;
  // distribute handlers
  handleDistToggle: (id: string) => void;
  handleDistAllocate: (targetIdx: number) => void;
  handleDistSubmit: () => void;
  handleDistClear: () => void;
  // 清理函数
  cancelTransform: () => void;
  cancelSelection: () => void;
  clearDiscard: () => void;
  setDistributeMode: (
    mode: { skillId: string; actionType: string; prompt: DistributePrompt } | null,
  ) => void;
}

/**
 * 出牌交互状态机。
 * 封装 GameView 原先散落在组件体内的所有出牌/回应/弃牌/转化/distribute 交互逻辑。
 */
export function usePlayInteraction(
  isMyTurn: boolean,
  canOperate: boolean,
  p: PlayInteractionParams,
): PlayInteractionResult {
  const { view, perspectiveIdx, perspectiveHand, skillActions } = p;
  const {
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
  } = p;

  const isMyAwaiting = isPerspectiveAwaiting && canOperate;

  // ─── 状态 ───
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedKillTarget, setSelectedKillTarget] = useState<string | null>(null);
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<string>>(new Set());
  const [transformMode, setTransformMode] = useState<TransformMode | null>(null);
  const [distributeMode, setDistributeMode] = useState<{
    skillId: string;
    actionType: string;
    prompt: DistributePrompt;
  } | null>(null);
  const [distSelected, setDistSelected] = useState<Set<string>>(new Set());
  const [distAllocations, setDistAllocations] = useState<
    Array<{ target: number; cardIds: string[] }>
  >([]);
  const [distTargetName, setDistTargetName] = useState<string | null>(null);

  // ─── distribute 上下文(主动技 + 被动遗计共用)───
  const perspectiveEquipment = view.players[perspectiveIdx]?.equipment ?? {};
  const activeDistribute = (() => {
    if (distributeMode) {
      const { skillId, actionType, prompt } = distributeMode;
      const cardIds = resolveDistributeCardIds(prompt, perspectiveHand, perspectiveEquipment);
      const externalTargetSelection = (prompt.mode ?? 'allocate') === 'allocate';
      return { skillId, actionType, prompt, cardIds, externalTargetSelection };
    }
    if (isMyAwaiting && pending?.prompt.type === 'distribute') {
      const skillId = pendingRespondInfo?.skillId ?? '系统规则';
      const cardIds = resolveDistributeCardIds(
        pending.prompt,
        perspectiveHand,
        perspectiveEquipment,
      );
      return {
        skillId,
        actionType: 'respond',
        prompt: pending.prompt,
        cardIds,
        externalTargetSelection: false,
      };
    }
    return null;
  })();
  const isDistributeActive = activeDistribute !== null;

  // ─── distribute 外部候选:cardIds 中不在手牌/装备区的牌(单独渲染)───
  // 计算这些牌的 Card 对象(通过 view.cardMap 查得),供 GameView 渲染独立候选区。
  // 用例:观星/界观星/界恂恂/界称象(牌堆顶牌)、界破军/界镇军(目标的牌)。
  const distExternalCandidates = useMemo(() => {
    if (!activeDistribute) return [];
    const handAndEquipIds = new Set<string>();
    for (const c of perspectiveHand) handAndEquipIds.add(c.id);
    for (const id of Object.values(perspectiveEquipment)) {
      if (typeof id === 'string') handAndEquipIds.add(id);
    }
    const out: Card[] = [];
    for (const id of activeDistribute.cardIds) {
      if (handAndEquipIds.has(id)) continue;
      const card = view.cardMap[id];
      if (card) out.push(card);
    }
    return out;
  }, [activeDistribute, perspectiveHand, perspectiveEquipment, view.cardMap]);

  // ─── state 重置 effects ───
  useEffect(() => {
    setSelectedForDiscard(new Set());
  }, [pending]);
  const distKey = activeDistribute
    ? `${activeDistribute.skillId}:${activeDistribute.actionType}:${activeDistribute.prompt.mode ?? 'allocate'}`
    : '';
  useEffect(() => {
    setDistSelected(new Set());
    setDistAllocations([]);
    setDistTargetName(null);
  }, [distKey]);
  useEffect(() => {
    setSelectedKillTarget(null);
  }, [selectedCardId]);

  // 转化模式自动取消:转化条件(回合/装备/手牌)随 view 变化可能不再满足
  // (如出牌阶段超时回合结束、丈八蛇矛被卸下、手牌不足)。此时若仍停留在转化模式,
  // 玩家会卡在无法提交的 UI。监听 transformMode 对应 action 的 active 状态,
  // 不再 active(或技能已卸载/视角切换)时自动退出转化模式。
  useEffect(() => {
    if (!transformMode) return;
    const action = skillActions.find(
      (a) => a.skillId === transformMode.skillId && a.actionType === transformMode.actionType,
    );
    if (!action || !isActiveAction(action, { view, perspectiveIdx })) {
      setTransformMode(null);
      setSelectedCardId(null);
      setSelectedTarget(null);
    }
  }, [transformMode, view, perspectiveIdx, skillActions]);

  // distribute(主动技)自动取消:distributeMode 对应的 action 不再 active 时
  // (如出牌阶段超时回合结束、视角切换、制衡/仁德限一次已用),清除 distribute 选择状态,
  // 避免玩家卡在无法提交的 UI。与上方 transformMode 自动取消逻辑对称。
  // 仅清理主动技分支(distributeMode);被动 pending 分支(遗计)由 pending 驱动,
  // pending 消失 activeDistribute 自然归 null,无需此处清理。
  useEffect(() => {
    if (!distributeMode) return;
    const action = skillActions.find(
      (a) => a.skillId === distributeMode.skillId && a.actionType === distributeMode.actionType,
    );
    if (!action || !isActiveAction(action, { view, perspectiveIdx })) {
      setDistributeMode(null);
      setDistSelected(new Set());
      setDistAllocations([]);
      setDistTargetName(null);
    }
  }, [distributeMode, view, perspectiveIdx, skillActions]);

  // 普通选牌:离开自由出牌窗口(回合结束/弃牌/阻塞询问)时清空,避免「取消选择」残留。
  useEffect(() => {
    if (isFreePlayWindow({ isMyTurn, phase: view.phase, pending })) return;
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, [isMyTurn, view.phase, pending]);

  // ─── 派生:选中的牌 + use action ───
  const selectedCard = selectedCardId
    ? (perspectiveHand.find((c) => c.id === selectedCardId) ?? null)
    : null;

  const selectedUseAction = (() => {
    if (transformMode) {
      // 多卡转化(丈八蛇矛):selectedCardId 为 null,直接用包装牌的 use action
      if (transformMode.minCards > 1) {
        return skillActions.find(
          (a) => a.actionType === 'use' && a.skillId === transformMode.wrapperName,
        );
      }
      // 单卡转化(武圣):需选中一张卡
      if (!selectedCard) return undefined;
      return skillActions.find(
        (a) => a.actionType === 'use' && a.skillId === transformMode.wrapperName,
      );
    }
    if (!selectedCard) return undefined;
    return findUseActionForCard(skillActions, selectedCard);
  })();
  const selectedTargetFilter =
    selectedUseAction?.prompt.type === 'useCardAndTarget'
      ? selectedUseAction.prompt.targetFilter
      : null;

  const playRules = selectedUseAction
    ? derivePlayRules(
        selectedTargetFilter,
        selectedUseAction.prompt.type === 'useCardAndTarget' && selectedUseAction.prompt.selfTarget,
      )
    : null;
  const selectedActive = selectedUseAction
    ? isActiveAction(selectedUseAction, { view, perspectiveIdx })
    : false;

  // ─── 派生:选中牌的替代动作(如铁索连环·重铸)───
  // 非 use 型 useCard action,cardFilter 匹配选中牌且 active 时可点击。
  const altActions = (() => {
    if (!selectedCard) return [];
    const ctx = { view, perspectiveIdx };
    return findAltActionsForCard(skillActions, selectedCard).filter((a) =>
      isActiveAction(a, ctx),
    );
  })();

  const playButtonState = (() => {
    if (!selectedCardId) return null;
    const card = perspectiveHand.find((c) => c.id === selectedCardId);
    if (!card || !selectedUseAction) return null;
    const rules = derivePlayRules(
      selectedTargetFilter,
      selectedUseAction.prompt.type === 'useCardAndTarget' && selectedUseAction.prompt.selfTarget,
    );
    let canPlay: boolean;
    let targetLabel: string;
    if (rules.hasSlots) {
      canPlay = !!selectedTarget && !!selectedKillTarget;
      targetLabel =
        selectedTarget && selectedKillTarget
          ? ` → A=${selectedTarget} B=${selectedKillTarget}`
          : ' (请选 A/B 两个目标)';
    } else if (rules.selfTarget) {
      canPlay = true;
      targetLabel = '';
    } else {
      canPlay = !rules.needsTarget || !!selectedTarget;
      targetLabel = selectedTarget
        ? ` → ${selectedTarget}`
        : rules.needsTarget
          ? ' (请选目标)'
          : '';
    }
    return { canPlay, targetLabel };
  })();

  // ─── handlers ───
  const nameToIndex = useCallback(
    (name: string): number => {
      return view.players.findIndex((pl) => pl.name === name);
    },
    [view.players],
  );

  const isTargetable = useCallback(
    (i: number): boolean => {
      if (isDistributeActive && activeDistribute) {
        const mode = activeDistribute.prompt.mode ?? 'allocate';
        // 制衡(select)无目标选择
        if (mode === 'select') return false;
        if (!activeDistribute.prompt.allowSelf && i === perspectiveIdx) return false;
        if (activeDistribute.prompt.targetFilter && !activeDistribute.prompt.targetFilter(view, i))
          return false;
        return view.players[i]?.alive === true;
      }
      const tf = selectedTargetFilter;
      // 多槽位目标(借刀杀人 A+B):按当前选择进度取对应槽位 filter 判断可选性
      if (tf?.slots && tf.slots.length > 1) {
        const slotIdx = selectedTarget ? 1 : 0;
        // 后续槽位不能重复选已选座次
        if (slotIdx === 1 && view.players[i]?.name === selectedTarget) return false;
        const slot = tf.slots[slotIdx];
        const ctxSelected =
          slotIdx === 1 ? [view.players.findIndex((p) => p.name === selectedTarget)] : [];
        return slot?.filter ? slot.filter(view, i, { selected: ctxSelected }) : true;
      }
      const filter = tf?.filter;
      if (!filter) return true;
      return filter(view, i);
    },
    [
      isDistributeActive,
      activeDistribute,
      perspectiveIdx,
      view,
      selectedTargetFilter,
      selectedTarget,
    ],
  );

  const handlePlayCard = useCallback(() => {
    if (!selectedCardId) return;
    const card = perspectiveHand.find((c) => c.id === selectedCardId);
    if (!card || !selectedUseAction) return;
    // use action 不 active 时不出(如满血时桃、杀超上限)
    if (!selectedActive) return;
    const rules = derivePlayRules(
      selectedTargetFilter,
      selectedUseAction.prompt.type === 'useCardAndTarget' && selectedUseAction.prompt.selfTarget,
    );
    const params = buildPlayParams(
      view.players,
      perspectiveIdx,
      card,
      rules,
      selectedTarget,
      selectedKillTarget,
    );
    if (params === null) return;
    // 出牌飞行动画:在 card 消失前捕获位置
    const cardEl = handListRef.current?.querySelector(
      `[data-card-id="${card.id}"]`,
    ) as HTMLElement | null;
    if (cardEl) createCardFlyAnimation(cardEl, card);
    send(selectedUseAction.skillId, 'use', params);
  }, [
    selectedCardId,
    perspectiveHand,
    selectedUseAction,
    selectedActive,
    selectedTargetFilter,
    view.players,
    perspectiveIdx,
    selectedTarget,
    selectedKillTarget,
    handListRef,
    send,
  ]);

  const handleTargetClick = useCallback(
    (name: string) => {
      const idx = view.players.findIndex((pl) => pl.name === name);
      if (idx >= 0 && !isTargetable(idx)) return;
      if (isDistributeActive && activeDistribute) {
        const mode = activeDistribute.prompt.mode ?? 'allocate';
        // 制衡(select)无目标,座位点击忽略
        if (mode === 'select') return;
        if (activeDistribute.externalTargetSelection) {
          // 仁德:点玩家设为目标
          if (!activeDistribute.prompt.allowSelf && idx === perspectiveIdx) return;
          setDistTargetName(distTargetName === name ? null : name);
          return;
        }
        // 遗计(内部 allocate):点玩家 = 分配当前选中牌
        if (distSelected.size > 0) {
          const maxPerTarget = activeDistribute.prompt.maxPerTarget ?? 99;
          setDistAllocations((prev) => {
            const already = prev
              .filter((a) => a.target === idx)
              .reduce((s, a) => s + a.cardIds.length, 0);
            if (already + distSelected.size > maxPerTarget) return prev;
            return [...prev, { target: idx, cardIds: [...distSelected] }];
          });
          setDistSelected(new Set());
        }
        return;
      }
      // 多槽位目标(借刀杀人):首次点选 A(slot 0),再点选 B(slot 1)
      if (playRules?.hasSlots) {
        const slotIdx = selectedTarget ? 1 : 0;
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
        return;
      }
      setSelectedTarget(selectedTarget === name ? null : name);
    },
    [
      view.players,
      isTargetable,
      isDistributeActive,
      activeDistribute,
      perspectiveIdx,
      distTargetName,
      selectedTarget,
      selectedKillTarget,
      distSelected,
      playRules,
    ],
  );

  const handleSkillAction = useCallback(
    (action: SkillActionDef) => {
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
          if (action.transform) {
            if (prompt.cardFilter?.filter) {
              const sample = perspectiveHand.find((c) => prompt.cardFilter.filter!(c));
              const wrapperName = sample ? action.transform(sample).name : action.skillId;
              const minCards = prompt.cardFilter.min ?? 1;
              const maxCards = prompt.cardFilter.max ?? 1;
              setTransformMode({
                skillId,
                actionType,
                cardFilter: prompt.cardFilter.filter,
                wrapperName,
                minCards,
                maxCards,
                selectedCardIds: [],
              });
              setSelectedCardId(null);
              setSelectedTarget(null);
              return;
            }
          }
          if (!selectedCardId || !selectedTarget) return;
          {
            const idx = nameToIndex(selectedTarget);
            if (idx < 0) return;
            params.cardId = selectedCardId;
            const trickCard = perspectiveHand.find((c) => c.id === selectedCardId);
            if (trickCard?.type === '锦囊牌' && trickCard.trickSubtype === '延时锦囊') {
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
    },
    [selectedCardId, selectedTarget, nameToIndex, perspectiveHand, send],
  );

  const handleTransformPlay = useCallback(
    (targetName: string) => {
      if (!transformMode) return;
      const idx = nameToIndex(targetName);
      if (idx < 0) return;

      if (transformMode.minCards > 1) {
        const ids = transformMode.selectedCardIds;
        if (ids.length < transformMode.minCards || ids.length > transformMode.maxCards) return;
        const shadowCardId = `${ids.join('#')}#${transformMode.skillId}`;
        send(transformMode.wrapperName, 'use', { cardId: shadowCardId, targets: [idx] }, [
          {
            skillId: transformMode.skillId,
            actionType: transformMode.actionType,
            params: { cardIds: ids },
          },
        ]);
      } else {
        if (!selectedCardId) return;
        const targetCard = perspectiveHand.find((c) => c.id === selectedCardId);
        if (!targetCard) return;
        const shadowCardId = `${selectedCardId}#${transformMode.skillId}`;
        send(transformMode.wrapperName, 'use', { cardId: shadowCardId, targets: [idx] }, [
          {
            skillId: transformMode.skillId,
            actionType: transformMode.actionType,
            params: { cardId: selectedCardId },
          },
        ]);
      }
      setTransformMode(null);
      setSelectedCardId(null);
      setSelectedTarget(null);
    },
    [transformMode, nameToIndex, selectedCardId, perspectiveHand, send],
  );

  const handleRespond = useCallback(
    (cardId?: string) => {
      if (!pending) return;
      if (isDiscardPhase) {
        if (selectedForDiscard.size >= discardMin) {
          handleConfirmDiscard();
        } else {
          const hand = perspectiveHand;
          const fallback = hand.slice(-discardMin).map((c) => c.id);
          send('系统规则', 'respond', { cardIds: fallback });
          setSelectedForDiscard(new Set());
        }
        return;
      }
      const info = pendingRespondInfo;
      if (!info) return;
      if (cardId) {
        const card = perspectiveHand.find((c) => c.id === cardId);
        if (!card) return;
        if (info.cardFilter && !info.cardFilter(card)) return;
        // 求桃:按救援牌路由到对应技能(桃/酒/急救);其他回应用默认 skillId
        const rescueSkill = info.rescueSkillForCard?.(card);
        send(rescueSkill ?? info.skillId, 'respond', { cardId });
      } else if (pendingTargetIdx < 0) {
        // 广播型 pending(无懈可击):发 skip 让服务端累计,全员 skip 时提前结束窗口
        send('__skip', 'skip', {});
        markBroadcastSkipped(broadcastKey);
      } else {
        send(info.skillId, 'respond', {});
      }
    },
    [
      pending,
      isDiscardPhase,
      selectedForDiscard,
      discardMin,
      perspectiveHand,
      send,
      pendingRespondInfo,
      pendingTargetIdx,
      markBroadcastSkipped,
      broadcastKey,
    ],
  );

  const handleEndTurn = useCallback(() => {
    if (!isMyTurn) return;
    send('回合管理', 'end', {});
  }, [isMyTurn, send]);

  const handleCardClick = useCallback(
    (card: Card) => {
      // distribute 选牌
      if (isDistributeActive && activeDistribute) {
        const candidateSet = new Set(activeDistribute.cardIds);
        if (!candidateSet.has(card.id)) return;
        handleDistToggle(card.id);
        return;
      }
      // 弃牌窗口
      if (isDiscardPhase && isPerspectiveAwaiting && canOperate) {
        setSelectedForDiscard((prev) => {
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
        if (pendingRespondInfo?.cardFilter) {
          if (pendingRespondInfo.cardFilter(card)) handleRespond(card.id);
        }
        return;
      }
      // 转化模式
      if (transformMode && isMyTurn && canOperate) {
        if (!transformMode.cardFilter(card)) return;
        if (transformMode.minCards > 1) {
          setSelectedCardId(null);
          setTransformMode(
            (prev) =>
              prev && {
                ...prev,
                selectedCardIds: prev.selectedCardIds.includes(card.id)
                  ? prev.selectedCardIds.filter((id) => id !== card.id)
                  : prev.selectedCardIds.length < prev.maxCards
                    ? [...prev.selectedCardIds, card.id]
                    : prev.selectedCardIds,
              },
          );
          setSelectedTarget(null);
        } else {
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
    },
    [
      isDistributeActive,
      activeDistribute,
      isDiscardPhase,
      isPerspectiveAwaiting,
      canOperate,
      discardMax,
      isMyAwaiting,
      pendingRespondInfo,
      handleRespond,
      transformMode,
      isMyTurn,
      selectedCardId,
    ],
  );

  const handleConfirmDiscard = useCallback(() => {
    if (!pending || !isDiscardPhase) return;
    if (selectedForDiscard.size < discardMin || selectedForDiscard.size > discardMax) return;
    const cardIds = Array.from(selectedForDiscard);
    send('系统规则', 'respond', { cardIds });
    setSelectedForDiscard(new Set());
  }, [pending, isDiscardPhase, selectedForDiscard, discardMin, discardMax, send]);

  // distribute handlers
  const handleDistToggle = useCallback(
    (id: string) => {
      if (!activeDistribute) return;
      const maxTotal = activeDistribute.prompt.maxTotal ?? 99;
      setDistSelected((prev) => {
        const n = new Set(prev);
        if (n.has(id)) {
          n.delete(id);
        } else {
          if (n.size >= maxTotal) return prev;
          n.add(id);
        }
        return n;
      });
    },
    [activeDistribute],
  );

  const handleDistAllocate = useCallback(
    (targetIdx: number) => {
      if (!activeDistribute) return;
      const maxPerTarget = activeDistribute.prompt.maxPerTarget ?? 99;
      if (distSelected.size === 0) return;
      setDistAllocations((prev) => {
        const already = prev
          .filter((a) => a.target === targetIdx)
          .reduce((s, a) => s + a.cardIds.length, 0);
        if (already + distSelected.size > maxPerTarget) return prev;
        return [...prev, { target: targetIdx, cardIds: [...distSelected] }];
      });
      setDistSelected(new Set());
    },
    [activeDistribute, distSelected],
  );

  const handleDistSubmit = useCallback(() => {
    if (!activeDistribute) return;
    const { skillId, actionType, prompt, externalTargetSelection } = activeDistribute;
    const mode = prompt.mode ?? 'allocate';
    const minTotal = prompt.minTotal ?? 1;
    if (mode === 'select') {
      if (distSelected.size < minTotal) return;
      send(skillId, actionType, { cardIds: [...distSelected] });
    } else if (externalTargetSelection) {
      if (distSelected.size < minTotal || !distTargetName) return;
      const idx = nameToIndex(distTargetName);
      if (idx < 0) return;
      send(skillId, actionType, { allocation: [{ target: idx, cardIds: [...distSelected] }] });
    } else {
      const total = distAllocations.flatMap((a) => a.cardIds).length;
      if (total < minTotal) return;
      send(skillId, actionType, { allocation: distAllocations });
    }
    setDistSelected(new Set());
    setDistAllocations([]);
    setDistTargetName(null);
    setDistributeMode(null);
  }, [activeDistribute, distSelected, distTargetName, distAllocations, nameToIndex, send]);

  const handleDistClear = useCallback(() => {
    setDistSelected(new Set());
    setDistAllocations([]);
    setDistTargetName(null);
  }, []);

  const cancelTransform = useCallback(() => {
    setTransformMode(null);
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, []);

  const cancelSelection = useCallback(() => {
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, []);

  const clearDiscard = useCallback(() => setSelectedForDiscard(new Set()), []);

  return {
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
    distExternalCandidates,
    selectedCard,
    selectedUseAction,
    selectedTargetFilter,
    playRules,
    selectedActive,
    playButtonState,
    altActions,
    handleCardClick,
    handlePlayCard,
    handleTargetClick,
    handleSkillAction,
    handleTransformPlay,
    handleRespond,
    handleEndTurn,
    handleConfirmDiscard,
    isTargetable,
    handleDistToggle,
    handleDistAllocate,
    handleDistSubmit,
    handleDistClear,
    cancelTransform,
    cancelSelection,
    clearDiscard,
    setDistributeMode,
  };
}
