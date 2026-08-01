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
import type {
  Card,
  GameView,
  Json,
  DistributePrompt,
  ConfirmPrompt,
  PendingView,
} from '../../engine/types';
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

/**
 * 有序选择 + FIFO 淘汰:点击一张牌 toggle 其选中状态。
 * - 已选 → 移除。
 * - 未选且未达上限(max>0)→ 追加到末尾,保持插入顺序。
 * - 未选且已达 max → 淘汰"最早选中的"(数组首位),再把新牌追加到末尾
 *   (而不是禁止选择),实现"选满后继续选自动取消最早那张"。
 * max 为 undefined/<=0 视为无上限,直接追加。
 * 用于弃牌阶段多选(按 discardMax)与多卡转化(按 transformMode.maxCards)。
 */
function toggleOrderedFifo(selected: string[], id: string, max?: number): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (max === undefined || max <= 0) return [...selected, id];
  if (selected.length < max) return [...selected, id];
  return [...selected.slice(1), id];
}

/** 全选:候选按序选中,超 max 时取前 max(自然阅读顺序,左→右)。max<=0/undefined=无上限。 */
function selectAllOrdered(candidates: string[], max?: number): string[] {
  if (max === undefined || max <= 0) return [...candidates];
  return candidates.slice(0, max);
}

/**
 * 反选:取候选中当前未选的;结果超 max 时按 FIFO 保留较晚选的(取尾部)。
 * max<=0/undefined=无上限。
 */
function invertOrdered(candidates: string[], selected: string[], max?: number): string[] {
  const sel = new Set(selected);
  const complement = candidates.filter((c) => !sel.has(c));
  if (max === undefined || max <= 0) return complement;
  return complement.length > max ? complement.slice(-max) : complement;
}

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
  /** 多目标(铁索连环 1-2 人)已选目标 name 集合;单/槽位路径为空 */
  selectedMultiTargets: string[];
  /** 弃牌阶段多选(有序数组,插入顺序;FIFO 淘汰依赖此顺序) */
  selectedForDiscard: string[];
  // ─── 转化模式 ───
  transformMode: TransformMode | null;
  // ─── distribute ───
  distributeMode: { skillId: string; actionType: string; prompt: DistributePrompt } | null;
  // ─── confirm 型主动技确认弹窗(据守等 prompt.type==='confirm' 的 action) ───
  /** 待确认的 confirm 型 action;非 null 时 GameView 应渲染确认弹窗 */
  pendingConfirm: {
    skillId: string;
    actionType: string;
    prompt: ConfirmPrompt;
  } | null;
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
  /** useCard 类回应选中的牌 id(点牌选中,再点「打出」出牌);非回应窗口为 null */
  selectedRespondCardId: string | null;
  /** 选中牌的可用替代动作(如铁索连环·重铸),均已 active */
  altActions: SkillActionDef[];
  // ─── handlers ───
  handleCardClick: (card: Card) => void;
  handlePlayCard: () => void;
  handleTargetClick: (name: string) => void;
  handleSkillAction: (action: SkillActionDef) => void;
  handleTransformPlay: (targetName: string) => void;
  handleRespond: (cardId?: string) => void;
  /** useCard 类回应「打出」按钮:用选中的回应牌出牌 */
  handlePlayRespond: () => void;
  handleEndTurn: () => void;
  handleConfirmDiscard: () => void;
  /** 弃牌阶段:全选(截断到 discardMax) */
  handleDiscardSelectAll: () => void;
  /** 弃牌阶段:反选(超 discardMax 时按 FIFO 取尾部) */
  handleDiscardInvert: () => void;
  /** 多卡转化:全选(截断到 maxCards) */
  handleTransformSelectAll: () => void;
  /** 多卡转化:反选(超 maxCards 时按 FIFO 取尾部) */
  handleTransformInvert: () => void;
  isTargetable: (i: number) => boolean;
  // distribute handlers
  handleDistToggle: (id: string) => void;
  /** distribute select 模式(制衡):全选所有候选,截断到 maxTotal */
  handleDistSelectAll: () => void;
  /** distribute select 模式(制衡):反选,取候选中未选的,超 maxTotal 取尾部 */
  handleDistInvert: () => void;
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
  // ─── confirm 型确认弹窗 handlers ───
  /** 确认发动:send 后关闭弹窗 */
  handleConfirmYes: () => void;
  /** 不发动:仅关闭弹窗 */
  handleConfirmNo: () => void;
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
  // 多目标(铁索连环 max>=2):点击目标累加为集合,与单选/槽位路径互斥
  const [selectedMultiTargets, setSelectedMultiTargets] = useState<string[]>([]);
  // 弃牌阶段多选:有序数组(插入顺序),用于 FIFO 淘汰(选满 max 后再选自动取消最早那张)。
  const [selectedForDiscard, setSelectedForDiscard] = useState<string[]>([]);
  // useCard 类回应(被杀出闪/求桃/无懈可击等):先选牌(高亮)再点「打出」确认,避免误触直接出牌。
  // 与弃牌阶段 selectedForDiscard 同为「选+确认」两步式,但只选一张。
  const [selectedRespondCardId, setSelectedRespondCardId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode | null>(null);
  const [distributeMode, setDistributeMode] = useState<{
    skillId: string;
    actionType: string;
    prompt: DistributePrompt;
  } | null>(null);
  // confirm 型主动技(据守)确认弹窗状态:点按钮后先弹确认,确认才真正 send。
  const [pendingConfirm, setPendingConfirm] = useState<{
    skillId: string;
    actionType: string;
    prompt: ConfirmPrompt;
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
    setSelectedForDiscard([]);
  }, [pending]);
  // 询问窗口切换/打出后/不回应后:pending 变化驱动清空回应选牌,与 selectedForDiscard 同源。
  useEffect(() => {
    setSelectedRespondCardId(null);
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
  // 换牌时清空多目标集合(与 selectedKillTarget 同源,覆盖所有选牌/重置路径)
  useEffect(() => {
    setSelectedMultiTargets([]);
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

  // 选中牌已不在手牌(被打出/被偷/视图更新移除,或误点装备区装备)时清空,
  // 避免 selectedCardId 指向已不存在的牌 → 「取消选择」按钮残留却无牌高亮。
  useEffect(() => {
    if (selectedCardId && !perspectiveHand.some((c) => c.id === selectedCardId)) {
      setSelectedCardId(null);
      setSelectedTarget(null);
    }
  }, [selectedCardId, perspectiveHand]);

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
    } else if (rules.multiTarget) {
      const min = rules.targetFilter?.min ?? 1;
      canPlay = selectedMultiTargets.length >= min;
      targetLabel =
        selectedMultiTargets.length > 0
          ? ` → ${selectedMultiTargets.join('、')}`
          : ' (请选目标)';
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
      // 多槽位目标(借刀杀人 A+B):按当前选择进度取对应槽位 filter 判断可选性。
      // 槽位自身决定可选性（含是否允许自己作为 killTarget），不应用 self 排除。
      if (tf?.slots && tf.slots.length > 1) {
        const slotIdx = selectedTarget ? 1 : 0;
        // 后续槽位不能重复选已选座次
        if (slotIdx === 1 && view.players[i]?.name === selectedTarget) return false;
        const slot = tf.slots[slotIdx];
        const ctxSelected =
          slotIdx === 1 ? [view.players.findIndex((p) => p.name === selectedTarget)] : [];
        return slot?.filter ? slot.filter(view, i, { selected: ctxSelected }) : true;
      }
      // 多目标(铁索连环 max>=2):点击累加为集合。已选目标仍可点(用于取消);
      // 未达上限且通过 filter(含 allowSelf)才可选。与 playRules.multiTarget 对齐。
      if (playRules?.multiTarget && tf) {
        const name = view.players[i]?.name;
        if (name && selectedMultiTargets.includes(name)) return true;
        if (selectedMultiTargets.length >= tf.max) return false;
        if (i === perspectiveIdx && !tf.allowSelf) return false;
        return tf.filter ? tf.filter(view, i) : true;
      }
      // 单目标路径：自己仅当卡牌允许时可选（selfTarget=桃/酒自动目标；
      // allowSelf=铁索连环含自己）。避免决斗/火攻等无 filter 卡误选自己。
      if (i === perspectiveIdx) {
        const allowSelf =
          selectedUseAction?.prompt.type === 'useCardAndTarget' &&
          (!!selectedUseAction.prompt.selfTarget || !!tf?.allowSelf);
        if (!allowSelf) return false;
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
      selectedUseAction,
      selectedTarget,
      playRules,
      selectedMultiTargets,
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
      selectedMultiTargets,
    );
    if (params === null) return;
    // 出牌飞行动画:在 card 消失前捕获位置
    const cardEl = handListRef.current?.querySelector(
      `[data-card-id="${card.id}"]`,
    ) as HTMLElement | null;
    if (cardEl) createCardFlyAnimation(cardEl, card);
    send(selectedUseAction.skillId, 'use', params);
    // 与 handleSkillAction/handleTransformPlay 一致:提交后清空选中,
    // 否则牌飞走、离开手牌后 selectedCardId 仍指向它 → 「取消选择」残留却无牌高亮。
    setSelectedCardId(null);
    setSelectedTarget(null);
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
    selectedMultiTargets,
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
      // 转化模式(丈八蛇矛/武圣):永远只提交单目标(handleTransformPlay 取 targets:[idx]),
      // 不走多目标累加——否则杀的 targetFilter.max=3 会让 multiTarget=true,
      // 点击目标写入 selectedMultiTargets 而按钮只认 selectedTarget → 按钮卡住 disabled。
      if (transformMode) {
        setSelectedTarget(selectedTarget === name ? null : name);
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
      // 多目标(铁索连环 max>=2):点击目标 toggle 进/出集合
      if (playRules?.multiTarget) {
        setSelectedMultiTargets((prev) => {
          if (prev.includes(name)) return prev.filter((n) => n !== name);
          const max = playRules.targetFilter?.max ?? prev.length;
          if (prev.length >= max) return prev;
          return [...prev, name];
        });
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
      transformMode,
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
          // 不直接 send:先弹确认框,点「发动」才真正 send。
          setPendingConfirm({ skillId, actionType, prompt });
          return;
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
        if (selectedForDiscard.length >= discardMin) {
          handleConfirmDiscard();
        } else {
          const hand = perspectiveHand;
          const fallback = hand.slice(-discardMin).map((c) => c.id);
          const skillId = pendingRespondInfo?.skillId ?? '系统规则';
          send(skillId, 'respond', { cardIds: fallback });
          setSelectedForDiscard([]);
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

  // useCard 类回应「打出」按钮:用当前选中的回应牌发起 respond(走 handleRespond 的 cardId 分支,
  // 含求桃按救援牌路由/无懈可击默认 skillId),打出后立即清空选中(pending 变化也会清,这里即时反馈)。
  const handlePlayRespond = useCallback(() => {
    if (!selectedRespondCardId) return;
    const cardId = selectedRespondCardId;
    setSelectedRespondCardId(null);
    handleRespond(cardId);
  }, [selectedRespondCardId, handleRespond]);

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
        setSelectedForDiscard((prev) => toggleOrderedFifo(prev, card.id, discardMax));
        return;
      }
      // 回应模式:点牌只选中(高亮),不直接出牌;再点同一张取消选中。
      // 真正出牌由「打出」按钮(handlePlayRespond)触发,避免误触。求桃/无懈可击同此路径。
      if (isMyAwaiting) {
        if (pendingRespondInfo?.cardFilter) {
          if (pendingRespondInfo.cardFilter(card)) {
            setSelectedRespondCardId((prev) => (prev === card.id ? null : card.id));
          }
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
                selectedCardIds: toggleOrderedFifo(
                  prev.selectedCardIds,
                  card.id,
                  prev.maxCards,
                ),
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
      transformMode,
      isMyTurn,
      selectedCardId,
    ],
  );

  const handleConfirmDiscard = useCallback(() => {
    if (!pending || !isDiscardPhase) return;
    if (selectedForDiscard.length < discardMin || selectedForDiscard.length > discardMax) return;
    const cardIds = selectedForDiscard;
    // 系统弃牌阶段 → '系统规则';强制型技能弃牌(英魂) → pendingRespondInfo.skillId
    const skillId = pendingRespondInfo?.skillId ?? '系统规则';
    send(skillId, 'respond', { cardIds });
    setSelectedForDiscard([]);
  }, [pending, isDiscardPhase, selectedForDiscard, discardMin, discardMax, send, pendingRespondInfo]);

  // ─── 多选快捷:全选 / 反选(弃牌阶段 + 多卡转化) ───
  // 弃牌阶段候选=整手牌;转化候选=cardFilter 命中的牌。两者均受各自 max 截断。
  const handleDiscardSelectAll = useCallback(() => {
    setSelectedForDiscard(selectAllOrdered(perspectiveHand.map((c) => c.id), discardMax));
  }, [perspectiveHand, discardMax]);

  const handleDiscardInvert = useCallback(() => {
    setSelectedForDiscard((prev) =>
      invertOrdered(perspectiveHand.map((c) => c.id), prev, discardMax),
    );
  }, [perspectiveHand, discardMax]);

  const handleTransformSelectAll = useCallback(() => {
    setTransformMode(
      (prev) =>
        prev && {
          ...prev,
          selectedCardIds: selectAllOrdered(
            perspectiveHand.filter(prev.cardFilter).map((c) => c.id),
            prev.maxCards,
          ),
        },
    );
  }, [perspectiveHand]);

  const handleTransformInvert = useCallback(() => {
    setTransformMode((prev) => {
      if (!prev) return prev;
      const candidates = perspectiveHand.filter(prev.cardFilter).map((c) => c.id);
      return { ...prev, selectedCardIds: invertOrdered(candidates, prev.selectedCardIds, prev.maxCards) };
    });
  }, [perspectiveHand]);

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

  // distribute select 模式(制衡)全选:候选=activeDistribute.cardIds(手牌+装备+外部候选),
  // 按 maxTotal 截断(制衡 maxTotal=99 基本等同全选)。
  const handleDistSelectAll = useCallback(() => {
    if (!activeDistribute) return;
    const maxTotal = activeDistribute.prompt.maxTotal ?? 99;
    setDistSelected(new Set(selectAllOrdered(activeDistribute.cardIds, maxTotal)));
  }, [activeDistribute]);

  // distribute select 模式(制衡)反选:取候选中未选的,超 maxTotal 取尾部(与弃牌/转化反选同构)。
  const handleDistInvert = useCallback(() => {
    if (!activeDistribute) return;
    const maxTotal = activeDistribute.prompt.maxTotal ?? 99;
    setDistSelected(
      new Set(invertOrdered(activeDistribute.cardIds, [...distSelected], maxTotal)),
    );
  }, [activeDistribute, distSelected]);

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

  // ─── confirm 型确认弹窗 handlers ───
  const handleConfirmYes = useCallback(() => {
    setPendingConfirm((prev) => {
      if (!prev) return null;
      send(prev.skillId, prev.actionType, {});
      return null;
    });
  }, [send]);

  const handleConfirmNo = useCallback(() => {
    setPendingConfirm(null);
  }, []);

  const clearDiscard = useCallback(() => setSelectedForDiscard([]), []);

  return {
    selectedCardId,
    selectedTarget,
    selectedKillTarget,
    selectedMultiTargets,
    selectedForDiscard,
    transformMode,
    distributeMode,
    pendingConfirm,
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
    selectedRespondCardId,
    altActions,
    handleCardClick,
    handlePlayCard,
    handleTargetClick,
    handleSkillAction,
    handleTransformPlay,
    handleRespond,
    handlePlayRespond,
    handleEndTurn,
    handleConfirmDiscard,
    handleDiscardSelectAll,
    handleDiscardInvert,
    handleTransformSelectAll,
    handleTransformInvert,
    isTargetable,
    handleDistToggle,
    handleDistSelectAll,
    handleDistInvert,
    handleDistAllocate,
    handleDistSubmit,
    handleDistClear,
    cancelTransform,
    cancelSelection,
    clearDiscard,
    setDistributeMode,
    handleConfirmYes,
    handleConfirmNo,
  };
}
