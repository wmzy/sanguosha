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
  ActionPrompt,
  Card,
  CardWrapper,
  GameView,
  Json,
  DistributePrompt,
  PendingView,
  TargetFilter,
} from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import { getPendingRequestType, type PendingRespondInfo } from '../utils/pendingRespond';

import {
  buildPlayParams,
  derivePlayRules,
  findUseActionForCard,
  findAltActionsForCard,
  isActiveAction,
  isFreePlayWindow,
  resolveDistributeCardIds,
  extractCardFilter,
} from '../utils/gameViewHelpers';
import { createCardFlyAnimation } from '../utils/cardFlyAnimation';
import { targetCandidates, targetSelectionBounds, toggleTargetSelection, validateTargetSelection } from '../../engine/rules/target-selection';

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
  /** 多卡转化的组合约束(来自 prompt.cardFilter.comboFilter,如 乱击 两张同花色)。
   *  单卡 filter 表达不了「两张牌之间」的约束;缺了它玩家能选中非法组合并提交,
   *  引擎 validate 拒绝(点了没反应)。 */
  comboFilter?: (cards: Card[]) => boolean;
  wrapperName: string;
  /** 选牌数量范围(来自 cardFilter.min/max),单卡转化=1..1 */
  minCards: number;
  maxCards: number;
  /** 多卡模式下选中的卡 id 列表(单卡模式用 selectedCardId) */
  selectedCardIds: string[];
  /** 转化牌的目标过滤;max>=1 需选目标(丈八蛇矛→杀),max=0 为 AOE 无需选目标(乱击→万箭齐发) */
  targetFilter?: TargetFilter;
  /** 技能声明的转化回调(原卡 → 产出牌名)。方向必须由**当前选中的牌**决定:
   *  多向转化技(龙胆 杀↔闪 / 界龙胆 杀/闪/酒/桃)按进入模式时手牌里第一张匹配牌
   *  钉死方向,会让另一方向的主 action 不存在(按钮消失)或方向不符(引擎拒)。 */
  transform?: (card: Card) => CardWrapper;
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
  /** 当前转化方向的产出牌名(由选中的牌决定;未选牌时为进入模式时的样本名)。
   *  按钮文案与主 action 查找都用它——多向转化技的方向必须跟随选牌。 */
  transformWrapperName: string | null;
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
  /** 被询问杀(南蛮/决斗)时的回应上下文:转化技当杀打出走此路径 */
  /** 转化技回应上下文:pending 请求的牌名 = 转化后牌名(杀/闪/无懈可击 等)。
   *  转化技按钮据此在回应窗口激活,提交走 <请求牌名>.respond + preceding transform。 */
  isRespondTransformContext: boolean;
  /** useCard 类回应选中的牌 id(点牌选中,再点「打出」出牌);非回应窗口为 null */
  selectedRespondCardId: string | null;
  /** useCardAndTarget 类回应(借刀杀人/出杀)选中的目标座次 name;非此模式为 null */
  respondTargetName: string | null;
  respondTargets: number[];
  /** 当前回应是否需要选目标(useCardAndTarget 且非 selfTarget) */
  respondNeedsTarget: boolean;
  /** respond 目标是否已满足(选了牌 + 选了目标) */
  respondTargetReady: boolean;
  /** 选中牌的可用替代动作(如铁索连环·重铸),均已 active */
  altActions: SkillActionDef[];
  // ─── handlers ───
  handleCardClick: (card: Card) => void;
  handlePlayCard: () => void;
  handleTargetClick: (name: string) => void;
  handleSkillAction: (action: SkillActionDef, extraParams?: Record<string, Json>) => void;
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
  /** 主动技选目标模式:selectTarget/choosePlayer 型技能按钮已点开、等待点座位选目标。
   *  座位环据此进入「可选目标」高亮态(与 playRules.needsTarget 同一套 UI 语义)。 */
  skillTargetMode: boolean;
  /** 清空回应选牌/换目标(Esc 快捷键用):与 pending 切换自动清空同一对 setter */
  clearRespondSelection: () => void;
  /** 双击手牌:可回应牌直接打出(无需目标时);自由出牌无目标牌直接出,
   *  需目标的退化为单击选中。两步确认仍保留——双击是快捷路径,不是替代。 */
  handleCardDoubleClick: (card: Card) => void;
  /** 转化提交派生(与 CenterActionBar「使用」按钮同源,Enter 快捷键复用) */
  transformSubmit: { needsTarget: boolean; canSubmit: boolean } | null;
  /** distribute 提交派生(与 CenterActionBar 提交按钮同源,Enter 快捷键复用) */
  distSubmit: { canSubmit: boolean; label: string } | null;
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

  // 回应窗口请求的牌名:询问X → X(询问杀/询问闪);请求回应 'R/...' → R(杀/respondKill、
  // 无懈可击、闪、桃/求桃…)。转化技(武圣/丈八蛇矛/龙胆/倾国/看破)在该窗口下可"当 R 打出"。
  const pendingAtom = pending?.atom as { type?: string; requestType?: string } | undefined;
  const pendingRequestedName = (() => {
    if (!isMyAwaiting || !pending) return null;
    const t = pendingAtom?.type ?? '';
    if (t.startsWith('询问')) return t.slice(2) || null;
    if (t === '请求回应') {
      const rt = getPendingRequestType(pending);
      if (!rt) return null;
      const sep = rt.search(/[/_]/);
      return (sep >= 0 ? rt.slice(0, sep) : rt) || null;
    }
    return null;
  })();

  /** 转化技回应上下文:当前 pending 请求的牌名与转化后的牌名一致 → 转化牌走 R.respond 路径。
   *  覆盖 杀(武圣/丈八蛇矛/龙胆/界龙胆:南蛮/决斗/激将)、闪(倾国/龙胆:被杀指定)、
   *  无懈可击(看破:广播窗口)等所有"被要求打出某牌"的窗口。
   *  此前只认 杀(询问杀 / 请求回应 杀/respondKill)→ 倾国/看破/龙胆的闪侧整类无法回应。 */
  const isRespondTransformContext =
    pendingRequestedName !== null &&
    !!pending &&
    (pending.target === perspectiveIdx || pending.target < 0);

  // ─── 状态 ───
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  /** 主动技选目标模式:点击 selectTarget/choosePlayer 型技能按钮后置位(见 handleSkillAction),
   *  提交或取消时清空。座位可选性由 isTargetable 按该 action 的 prompt 判定;
   *  params 保存按钮变体参数(强袭代价 cost),提交时一并发出。 */
  const [pendingSkillAction, setPendingSkillAction] = useState<{
    action: SkillActionDef;
    params: Record<string, Json>;
  } | null>(null);
  const [selectedKillTarget, setSelectedKillTarget] = useState<string | null>(null);
  // 多目标(铁索连环 max>=2):点击目标累加为集合,与单选/槽位路径互斥
  const [selectedMultiTargets, setSelectedMultiTargets] = useState<string[]>([]);
  // 弃牌阶段多选:有序数组(插入顺序),用于 FIFO 淘汰(选满 max 后再选自动取消最早那张)。
  const [selectedForDiscard, setSelectedForDiscard] = useState<string[]>([]);
  // useCard 类回应(被杀出闪/求桃/无懈可击等):先选牌(高亮)再点「打出」确认,避免误触直接出牌。
  // 与弃牌阶段 selectedForDiscard 同为「选+确认」两步式,但只选一张。
  const [selectedRespondCardId, setSelectedRespondCardId] = useState<string | null>(null);
  // useCardAndTarget 类回应(借刀杀人/出杀):选中杀牌后再选目标座次 name,满足后「打出」可提交。
  // respond 模式独立于出牌阶段的 selectedTarget,避免与出牌选牌状态互相干扰。
  const [respondTargets, setRespondTargets] = useState<number[]>([]);
  const respondTargetName = respondTargets.map((index) => view.players[index]?.name).filter(Boolean).join('、') || null;
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
  // altAction 覆盖:用户点击替代 use action(如断粮)按钮后,用它覆盖默认 selectedUseAction,
  // 使后续选目标 + 提交走该 action 而非主 use action(如杀)。选中牌变化/提交后清除。
  const [altActionOverride, setAltActionOverride] = useState<SkillActionDef | null>(null);

  // ─── distribute 上下文(主动技 + 被动遗计共用)───
  const perspectiveEquipment = useMemo(
    () => view.players[perspectiveIdx]?.equipment ?? {},
    [view.players, perspectiveIdx],
  );
  const activeDistribute = (() => {
    if (distributeMode) {
      const { skillId, actionType, prompt } = distributeMode;
      const cardIds = resolveDistributeCardIds(prompt, perspectiveHand, perspectiveEquipment, view.cardMap);
      const externalTargetSelection = (prompt.mode ?? 'allocate') === 'allocate';
      return { skillId, actionType, prompt, cardIds, externalTargetSelection };
    }
    if (isMyAwaiting && pending?.prompt.type === 'distribute') {
      const skillId = pendingRespondInfo?.skillId ?? '系统规则';
      const cardIds = resolveDistributeCardIds(
        pending.prompt,
        perspectiveHand,
        perspectiveEquipment,
        view.cardMap,
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
    setRespondTargets([]);
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
    // 选中牌变化时清除 altAction 覆盖(避免覆盖指向已失效的牌)
    setAltActionOverride(null);
  }, [selectedCardId, perspectiveHand]);

  // ─── 派生:选中的牌 + use action ───
  const selectedCard = selectedCardId
    ? (perspectiveHand.find((c) => c.id === selectedCardId) ?? null)
    : null;

  // 转化方向 = 当前选中牌的产出牌名(而非进入模式时手牌里第一张匹配牌的产出名)。
  // 未选牌时回退到进入模式时的样本名(仅用于按钮文案占位)。
  const transformWrapperName = (() => {
    if (!transformMode) return null;
    const ids =
      transformMode.minCards > 1
        ? transformMode.selectedCardIds
        : selectedCardId
          ? [selectedCardId]
          : [];
    if (ids.length === 0 || !transformMode.transform) return transformMode.wrapperName;
    const card =
      perspectiveHand.find((c) => c.id === ids[0]) ??
      (Object.values(perspectiveEquipment).includes(ids[0]) ? view.cardMap[ids[0]] : undefined);
    if (!card || !transformMode.cardFilter(card)) return transformMode.wrapperName;
    return transformMode.transform(card).name;
  })();

  const selectedUseAction = (() => {
    if (transformMode) {
      if (!transformWrapperName) return undefined;
      // 多卡转化(丈八蛇矛):selectedCardId 为 null,直接用包装牌的 use action
      if (transformMode.minCards > 1) {
        return skillActions.find(
          (a) => a.actionType === 'use' && a.skillId === transformWrapperName,
        );
      }
      // 单卡转化(武圣/龙胆):需选中一张卡
      if (!selectedCard) return undefined;
      return skillActions.find((a) => a.actionType === 'use' && a.skillId === transformWrapperName);
    }
    if (!selectedCard) return undefined;
    // altAction 覆盖:用户点了替代 use action(如断粮)后,用它而非默认匹配的主 use action。
    // 仅当 override 的 cardFilter 仍匹配当前选中牌时生效(防迷叠)。
    if (altActionOverride) {
      const filter = extractCardFilter(altActionOverride.prompt);
      if (filter?.(selectedCard)) return altActionOverride;
    }
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
    return findAltActionsForCard(skillActions, selectedCard, selectedUseAction).filter((a) =>
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
        selectedMultiTargets.length > 0 ? ` → ${selectedMultiTargets.join('、')}` : ' (请选目标)';
    } else {
      canPlay = !rules.needsTarget || !!selectedTarget;
      targetLabel = selectedTarget
        ? ` → ${selectedTarget}`
        : rules.needsTarget
          ? ' (请选目标)'
          : '';
    }
    if (rules.targetFilter && !rules.selfTarget) {
      const names = rules.hasSlots || rules.multiTarget ? selectedMultiTargets : selectedTarget ? [selectedTarget] : [];
      canPlay = validateTargetSelection(view, perspectiveIdx, rules.targetFilter,
        names.map((name) => view.players.findIndex((player) => player.name === name)), card);
    }
    return { canPlay, targetLabel };
  })();

  // ─── respond 模式派生(useCardAndTarget 类回应,如借刀杀人/出杀)───
  // respond 与主动出牌是两套独立交互,不复用 selectedTarget/selectedUseAction。
  // respondTargetFilter 来自 pending.prompt.targetFilter(经投影层下发);无 filter 时
  // 前端以「其他存活玩家」作 UI 提示,后端 validate 权威校验距离/必含等约束。
  const respondTargetFilter =
    isMyAwaiting && pending?.prompt?.type === 'useCardAndTarget'
      ? pending.prompt.targetFilter
      : null;
  const respondNeedsTarget =
    isMyAwaiting && pending?.prompt?.type === 'useCardAndTarget' && !pending.prompt.selfTarget;
  const respondCard = perspectiveHand.find((card) => card.id === selectedRespondCardId);
  const respondTargetReady = !respondNeedsTarget || (!!respondTargetFilter &&
    validateTargetSelection(view, perspectiveIdx, respondTargetFilter, respondTargets, respondCard));

  // ─── handlers ───
  const nameToIndex = useCallback(
    (name: string): number => {
      return view.players.findIndex((pl) => pl.name === name);
    },
    [view.players],
  );

  /** 变体声明的额外代价牌(如强袭·弃武器需要一张武器牌)填入 params.cardId:
   *  优先当前选中的手牌(须满足变体 cardFilter),否则自己的装备区武器。
   *  PlayerCardLarge 传入的 extraParams 可能是副本,故变体定位先按引用、再按内容。 */
  const fillVariantCostCard = useCallback(
    (prompt: ActionPrompt, extra: Record<string, Json>, params: Record<string, Json>): void => {
      if (prompt.type !== 'selectTarget' || !prompt.paramVariants) return;
      const variant =
        prompt.paramVariants.find((v) => v.params === extra) ??
        prompt.paramVariants.find((v) => JSON.stringify(v.params) === JSON.stringify(extra));
      const filter = variant?.cardFilter;
      if (!filter || params.cardId !== undefined) return;
      const selected = selectedCardId
        ? perspectiveHand.find((c) => c.id === selectedCardId)
        : undefined;
      const handCard = selected && filter(selected) ? selected : undefined;
      const equipCard = Object.values(perspectiveEquipment)
        .map((id) => (typeof id === 'string' ? view.cardMap[id] : undefined))
        .find((c): c is Card => !!c && filter(c));
      const cost = handCard ?? equipCard;
      if (cost) params.cardId = cost.id;
    },
    [selectedCardId, perspectiveHand, perspectiveEquipment, view.cardMap],
  );

  /** 提交 selectTarget/choosePlayer 型主动技(目标名 → 座次)。
   *  单选(max<=1)技能在点座位时即提交;当前全部 selectTarget/choosePlayer 均 max:1,单选提交。
   *  target 与 targets 同时携带:反间/攻心/雄乱 读 targets(单选也须为长度 1 数组),
   *  挑衅/强袭/激将 读 target。 */
  const submitSkillTarget = useCallback(
    (action: SkillActionDef, targetName: string, extra: Record<string, Json>) => {
      const idx = nameToIndex(targetName);
      if (idx < 0) return;
      const params: Record<string, Json> = { ...extra, target: idx, targets: [idx] };
      // 变体声明的代价牌(强袭·弃武器):提交时兜底补 params.cardId ——
      // 覆盖「先点技能按钮、后选武器牌、再点目标」的顺序。
      fillVariantCostCard(action.prompt, extra, params);
      send(action.skillId, action.actionType, params);
      setSelectedTarget(null);
      setSelectedCardId(null);
      setPendingSkillAction(null);
    },
    [nameToIndex, send, fillVariantCostCard],
  );

  const isTargetable = useCallback(
    (i: number): boolean => {
      // 主动技选目标模式(selectTarget/choosePlayer):按该 action 的 prompt 判定可选性,
      // 与出牌选目标共用座位高亮/点击链路(此前这些技能没有进入选目标模式的入口)。
      if (pendingSkillAction) {
        const p = pendingSkillAction.action.prompt;
        if (!view.players[i]?.alive) return false;
        if (p.type === 'selectTarget') {
          if (i === perspectiveIdx && !p.targetFilter.allowSelf) return false;
          return p.targetFilter.filter ? p.targetFilter.filter(view, i) : true;
        }
        if (p.type === 'choosePlayer') {
          if (p.candidates) return p.candidates.includes(i);
          if (p.filter && !p.filter(view, i)) return false;
          return true;
        }
      }
      if (isDistributeActive && activeDistribute) {
        const mode = activeDistribute.prompt.mode ?? 'allocate';
        // 制衡(select)无目标选择
        if (mode === 'select') return false;
        if (!activeDistribute.prompt.allowSelf && i === perspectiveIdx) return false;
        if (activeDistribute.prompt.targetFilter && !activeDistribute.prompt.targetFilter(view, i))
          return false;
        return view.players[i]?.alive === true;
      }
      const tf = isMyAwaiting && respondTargetFilter ? respondTargetFilter : selectedTargetFilter;
      if (!tf) return !!view.players[i]?.alive;
      const names = playRules?.hasSlots || playRules?.multiTarget
        ? selectedMultiTargets.length ? selectedMultiTargets : [selectedTarget, selectedKillTarget].filter((name): name is string => name !== null)
        : selectedTarget ? [selectedTarget] : [];
      const selected = isMyAwaiting && respondTargetFilter ? respondTargets : names.map((name) => view.players.findIndex((player) => player.name === name));
      if (selected.includes(i)) return true;
      // 目标约束的 card 参数只在「这张牌就是正在使用的牌」时有意义:
      //   · 回应窗口(出闪/出杀)用的是正在打出的牌;
      //   · 主动出牌 useCard 型(杀本体)/ 有转化产出牌名时同理;
      //   · useCardAndTarget 但无产出名(离间 弃一张牌 + 选两名男性)里的选中牌是代价牌,
      //     不能按杀的动态目标上限解释(否则上限塌成 1,永远提交不出合法目标数)。
      const usingSelected = !selectedTargetFilter
        || !!transformWrapperName
        || selectedCard?.name === '杀';
      const card = isMyAwaiting && respondTargetFilter
        ? respondCard
        : selectedCard && usingSelected
          ? { ...selectedCard, name: transformWrapperName ?? selectedCard.name }
          : undefined;
      const { max } = targetSelectionBounds(view, perspectiveIdx, tf, card);
      const prefix = !tf.slots?.length && max === 1 ? [] : selected;
      return prefix.length < max && targetCandidates(view, perspectiveIdx, tf, prefix, card).includes(i);
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
      selectedCard,
      isMyAwaiting,
      respondTargetFilter,
      respondTargets,
      respondCard,
      selectedKillTarget,
      transformWrapperName,
      pendingSkillAction,
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
      view,
    );
    if (params === null) return;
    // 出牌飞行动画:在 card 消失前捕获位置
    const cardEl = handListRef.current?.querySelector(
      `[data-card-id="${card.id}"]`,
    ) as HTMLElement | null;
    if (cardEl) createCardFlyAnimation(cardEl, card);
    // actionType 用 action 自己声明的(而非硬编码 'use'):声明型主动技(蛊惑/界蛊惑)把
    // 声明编码进 actionType(`use:杀`),硬编码 'use' 会让引擎侧找不到 action 条目 → 恒拒。
    send(selectedUseAction.skillId, selectedUseAction.actionType, params);
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
      // 主动技选目标模式:单选技能(挑衅/强袭/反间 等 max=1)点座位即提交,无需再点按钮
      if (pendingSkillAction) {
        const p = pendingSkillAction.action.prompt;
        const maxTargets =
          p.type === 'selectTarget'
            ? (p.targetFilter.max ?? 1)
            : p.type === 'choosePlayer'
              ? (p.max ?? 1)
              : 1;
        if (maxTargets <= 1) {
          submitSkillTarget(pendingSkillAction.action, name, pendingSkillAction.params);
          return;
        }
      }
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
      // respond 模式 useCardAndTarget(借刀杀人/出杀):点目标 toggle 选中,与出牌阶段 selectedTarget 独立。
      // 不依赖 selectedCardId/selectedUseAction(respond 时两者均空),直接操作 respondTargetName。
      if (isMyAwaiting && respondTargetFilter) {
        setRespondTargets((previous) => toggleTargetSelection(view, perspectiveIdx, respondTargetFilter, previous, idx, respondCard));
        return;
      }
      if (playRules?.targetFilter && (playRules.hasSlots || playRules.multiTarget)) {
        const current = selectedMultiTargets.map((target) => view.players.findIndex((player) => player.name === target));
        const card = selectedCard ? { ...selectedCard, name: transformWrapperName ?? selectedCard.name } : undefined;
        const next = toggleTargetSelection(view, perspectiveIdx, playRules.targetFilter, current, idx, card);
        const names = next.map((target) => view.players[target].name);
        setSelectedMultiTargets(names);
        setSelectedTarget(names[0] ?? null);
        setSelectedKillTarget(playRules.hasSlots ? names[1] ?? null : null);
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
      isMyAwaiting,
      respondTargetFilter,
      respondCard,
      selectedCard,
      selectedMultiTargets,
      transformWrapperName,
      view,
      pendingSkillAction,
      submitSkillTarget,
    ],
  );

  const handleSkillAction = useCallback(
    (
      action: SkillActionDef,
      /** 按钮变体参数(强袭 selectTarget 的代价 cost 等):与 prompt.paramVariants 对应,
       *  由 PlayerCardLarge 按变体渲染的按钮传入;无变体时缺省 {}。 */
      extraParams?: Record<string, Json>,
    ) => {
      const { skillId, actionType, prompt } = action;
      const params: Record<string, Json> = { ...(extraParams ?? {}) };
      // 变体声明的代价牌(强袭·弃武器):点击变体按钮时已选中武器牌 → 立即带上 cardId
      fillVariantCostCard(prompt, extraParams ?? {}, params);
      // selectTarget/choosePlayer 型主动技:需要目标。无目标时先进入选目标模式
      // (座位环按 prompt 的 targetFilter/filter 高亮),选好目标再点按钮提交——
      // 与出牌(选牌→选目标→出牌)同一交互范式。此前无目标直接 return,按钮点了没反应。
      if (prompt.type === 'selectTarget' || prompt.type === 'choosePlayer') {
        const maxTargets =
          prompt.type === 'selectTarget' ? (prompt.targetFilter.max ?? 1) : (prompt.max ?? 1);
        if (!selectedTarget) {
          // 未选目标:进入选目标模式(座位环按 prompt 的 targetFilter/filter 高亮)
          setPendingSkillAction({ action, params });
          setSelectedCardId(null);
          return;
        }
        if (maxTargets <= 1) {
          // 已选目标 + 单选技能:直接提交(与点座位即提交同一路径)
          submitSkillTarget(action, selectedTarget, params);
          return;
        }
        setPendingSkillAction(null);
      }

      switch (prompt.type) {
        case 'useCard':
          // 转化技(倾国黑牌当闪/看破黑牌当无懈):进入转化选牌模式,而非直接提交 cardId——
          // 主 action 是转化后的牌名(闪/无懈可击),牌面由影子卡承载。
          if (action.transform) {
            const minCards = prompt.cardFilter.min ?? 1;
            const maxCards = prompt.cardFilter.max ?? 1;
            const filter = prompt.cardFilter.filter;
            // wrapperName 由 transform 对一张代表性匹配牌求值(无匹配牌时用技能名兜底)
            const sample = filter ? perspectiveHand.find((c) => filter(c)) : perspectiveHand[0];
            setTransformMode({
              skillId,
              actionType,
              cardFilter: filter ?? (() => true),
              comboFilter: prompt.cardFilter.comboFilter,
              transform: action.transform,
              wrapperName: sample ? action.transform(sample).name : skillId,
              minCards,
              maxCards,
              selectedCardIds: [],
            });
            setSelectedCardId(null);
            setSelectedTarget(null);
            return;
          }
          if (!selectedCardId) return;
          params.cardId = selectedCardId;
          params.cardIds = [selectedCardId];
          break;
        case 'selectTarget':
          if (!selectedTarget) return;
          params.target = nameToIndex(selectedTarget);
          // targets 数组同时携带:反间/攻心/雄乱 读 params.targets(单选也必须为长度 1 的数组),
          // 挑衅/强袭/激将 读 params.target。只发 target 会让反间族 validate 恒拒。
          params.targets = [params.target];
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
                comboFilter: prompt.cardFilter.comboFilter,
                transform: action.transform,
                wrapperName,
                minCards,
                maxCards,
                selectedCardIds: [],
                targetFilter: prompt.targetFilter,
              });
              setSelectedCardId(null);
              setSelectedTarget(null);
              return;
            }
          }
          // 需要选中牌 + 目标。若已选牌但未选目标,设为 altActionOverride:
          // 后续选目标后,selectedUseAction 会走此 action 提交(handlePlayCard)。
          // 这让转化类主动技(断粮/界断粮)能从 altAction 按钮进入"选目标"流程。
          if (!selectedCardId) return;
          if (!selectedTarget) {
            setAltActionOverride(action);
            return;
          }
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
        case 'choosePlayer':
          if (!selectedTarget) return;
          params.target = nameToIndex(selectedTarget);
          break;
        case 'distribute':
          setDistributeMode({ skillId, actionType, prompt });
          setSelectedCardId(null);
          setSelectedTarget(null);
          return;
        case 'chooseOption':
          // chooseOption 型主动技(决堰:废除哪个装备栏):选项值由按钮变体放进 extraParams
          // (skillActionVariants 每个选项展开一个按钮 → params.option)。缺 option 说明按钮
          // 未按变体渲染,直接不发 —— 与 pending 侧 send(skillId,'respond',{option}) 同源。
          if (typeof params.option !== 'string') return;
          break;
        default:
          break;
      }

      send(skillId, actionType, params);
      setSelectedCardId(null);
      setSelectedTarget(null);
    },
    [selectedCardId, selectedTarget, nameToIndex, perspectiveHand, send, submitSkillTarget],
  );

  /** 多卡转化的组合约束校验(乱击/界乱击:两张同花色)。
   *  选中牌先查手牌,再查自己装备区(cardMap)——界父魂 的多卡转化原料含装备区。
   *  缺 comboFilter 时恒真(丈八蛇矛/界父魂 任意两张)。 */
  const transformComboOk = useCallback(
    (ids: string[]): boolean => {
      const filter = transformMode?.comboFilter;
      if (!filter || ids.length === 0) return true;
      const equipIds = new Set(Object.values(perspectiveEquipment).filter(Boolean));
      const cards: Card[] = [];
      for (const id of ids) {
        const card =
          perspectiveHand.find((c) => c.id === id) ??
          (equipIds.has(id) ? view.cardMap[id] : undefined);
        if (!card) return false;
        cards.push(card);
      }
      return filter(cards);
    },
    [transformMode, perspectiveHand, perspectiveEquipment, view.cardMap],
  );

  const handleTransformPlay = useCallback(
    (targetName: string) => {
      if (!transformMode) return;
      // 回应路径(被要求打出某牌):转化后按 R.respond 打出,无目标
      // (询问杀→武圣/丈八蛇矛;询问闪→倾国/龙胆;广播无懈→看破)
      if (!transformWrapperName) return;
      if (isRespondTransformContext && transformWrapperName === pendingRequestedName) {
        if (transformMode.minCards > 1) {
          // 多卡转化(丈八蛇矛):2 张手牌当杀打出
          const ids = transformMode.selectedCardIds;
          if (ids.length < transformMode.minCards || ids.length > transformMode.maxCards) return;
          if (!transformComboOk(ids)) return; // 组合约束(同花色)不满足 → 不提交
          const shadowCardId = `${ids.join('#')}#${transformMode.skillId}`;
          send(transformWrapperName, 'respond', { cardId: shadowCardId }, [
            {
              skillId: transformMode.skillId,
              actionType: transformMode.actionType,
              params: { cardIds: ids },
            },
          ]);
          setTransformMode(null);
          setSelectedCardId(null);
          setSelectedTarget(null);
          return;
        }
        if (!selectedCardId) return;
        const targetCard = perspectiveHand.find((c) => c.id === selectedCardId);
        if (!targetCard) return;
        const shadowCardId = `${selectedCardId}#${transformMode.skillId}`;
        send(transformWrapperName, 'respond', { cardId: shadowCardId }, [
          {
            skillId: transformMode.skillId,
            actionType: transformMode.actionType,
            params: { cardId: selectedCardId },
          },
        ]);
        setTransformMode(null);
        setSelectedCardId(null);
        setSelectedTarget(null);
        return;
      }
      // 自由出牌门(与 transformSubmit/CenterActionBar「使用」按钮同源):产出牌 use action
      // 不 active 时直接 return 不发消息——Enter 与按钮两条提交路径判定必须同源。
      if (!(selectedActive || isRespondTransformContext)) return;
      // 目标语义由产出牌自己的 use action 决定(playRules 来自 selectedUseAction):
      // 酒(useCard,无目标)/桃(selfTarget,自动以自己为目标)/杀(攻击范围内选目标)。
      // 沿用 transform action 自己的 targetFilter 会把「对他人」的目标塞给 酒/桃 → 引擎恒拒。
      const needsManualTarget = playRules
        ? playRules.needsTarget && !playRules.selfTarget
        : transformMode.targetFilter
          ? transformMode.targetFilter.max >= 1
          : true;
      const idx = needsManualTarget ? nameToIndex(targetName) : -1;
      if (needsManualTarget && idx < 0) return;

      if (transformMode.minCards > 1) {
        const ids = transformMode.selectedCardIds;
        if (ids.length < transformMode.minCards || ids.length > transformMode.maxCards) return;
        if (!transformComboOk(ids)) return; // 组合约束(同花色)不满足 → 不提交
        const shadowCardId = `${ids.join('#')}#${transformMode.skillId}`;
        const mainParams: Record<string, Json> = { cardId: shadowCardId };
        if (playRules?.selfTarget) mainParams.targets = [perspectiveIdx];
        else if (needsManualTarget) mainParams.targets = [idx];
        send(transformWrapperName, 'use', mainParams, [
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
        const mainParams: Record<string, Json> = { cardId: shadowCardId };
        if (playRules?.selfTarget) mainParams.targets = [perspectiveIdx];
        else if (needsManualTarget) mainParams.targets = [idx];
        send(transformWrapperName, 'use', mainParams, [
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
    [
      transformMode,
      transformWrapperName,
      transformComboOk,
      isRespondTransformContext,
      pendingRequestedName,
      nameToIndex,
      selectedCardId,
      perspectiveHand,
      perspectiveIdx,
      playRules,
      selectedActive,
      send,
    ],
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
        // useCardAndTarget 类回应：目标数组经共享约束解释器校验并原样提交。
        if (respondNeedsTarget && respondTargetFilter) {
          if (!validateTargetSelection(view, perspectiveIdx, respondTargetFilter, respondTargets, card)) return;
          send(rescueSkill ?? info.skillId, 'respond', { cardId, targets: respondTargets });
        } else {
          send(rescueSkill ?? info.skillId, 'respond', { cardId });
        }
      } else if (pendingTargetIdx < 0) {
        // 广播型 pending(无懈可击):发 skip 让服务端累计,全员 skip 时提前结束窗口
        send('__skip', 'skip', {});
        markBroadcastSkipped(broadcastKey);
      } else {
        send(info.skillId, 'respond', {});
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleConfirmDiscard 定义在后面(const TDZ),其依赖已被本数组覆盖
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
      respondNeedsTarget,
      respondTargets,
      respondTargetFilter,
      perspectiveIdx,
      view,
    ],
  );

  const handleEndTurn = useCallback(() => {
    if (!isMyTurn) return;
    send('回合管理', 'end', {});
  }, [isMyTurn, send]);

  // useCard/useCardAndTarget 类回应「打出」按钮:用当前选中的回应牌发起 respond。
  // useCardAndTarget(借刀杀人/出杀)还需已选目标(respondTargetReady)。
  const handlePlayRespond = useCallback(() => {
    if (!selectedRespondCardId) return;
    if (!respondTargetReady) return;
    const cardId = selectedRespondCardId;
    setSelectedRespondCardId(null);
    setRespondTargets([]);
    handleRespond(cardId);
  }, [selectedRespondCardId, respondTargetReady, handleRespond]);

  const clearRespondSelection = useCallback(() => {
    setSelectedRespondCardId(null);
    setRespondTargets([]);
  }, []);

  // 双击手牌(快速提交);误触风险由「仅无目标牌即时提交」约束兜底:
  //   - 回应窗口:可回应牌双击直接打出;需目标的(借刀杀人出杀)退化为选中,仍需点目标+「打出」。
  //   - 自由出牌:无目标牌(装备/无中生有/桃酒等)双击直接出;需目标的退化为单击选中。
  //   - 弃牌/转化/distribute 窗口:多选语义,双击不接(保持 toggle,由 hover 提示仍可见)。
  const handleCardDoubleClick = useCallback(
    (card: Card) => {
      // 与 handleCardClick 首行一致:双击出牌即退出技能选目标模式,
      // 否则 armed 的 pendingSkillAction 残留,下一次点座位会用陈旧 variant 提交
      // (强袭·弃武器 → 误弃武器)。
      setPendingSkillAction(null);
      if (!canOperate || isDistributeActive) return;
      if (isDiscardPhase && isPerspectiveAwaiting) return;
      if (transformMode) return;
      // 回应窗口
      if (isMyAwaiting) {
        // 转化回应路径(询问杀/闪/无懈)的拦截由上方 `if (transformMode) return` 承担:
        // 只有已进入转化选牌模式时双击才让位;字面可回应牌(如询问闪手中的闪)双击仍应直接打出,
        // 非匹配牌由下方 cardFilter 拦截。
        if (!pendingRespondInfo?.cardFilter?.(card)) return;
        if (respondNeedsTarget) {
          setSelectedRespondCardId(card.id);
          return;
        }
        setSelectedRespondCardId(null);
        handleRespond(card.id);
        return;
      }
      // 自由出牌窗口
      if (!isMyTurn) return;
      const useAction = findUseActionForCard(skillActions, card);
      if (!useAction || !isActiveAction(useAction, { view, perspectiveIdx })) return;
      const rules = derivePlayRules(
        useAction.prompt.type === 'useCardAndTarget' ? useAction.prompt.targetFilter : null,
        useAction.prompt.type === 'useCardAndTarget' && !!useAction.prompt.selfTarget,
      );
      if (rules.needsTarget && !rules.selfTarget) {
        // 需目标:选中交给「点目标/出牌按钮」路径
        setSelectedCardId(card.id);
        setSelectedTarget(null);
        return;
      }
      const params = buildPlayParams(view.players, perspectiveIdx, card, rules, null, null, []);
      if (!params) return;
      const cardEl = handListRef.current?.querySelector(
        `[data-card-id="${card.id}"]`,
      ) as HTMLElement | null;
      if (cardEl) createCardFlyAnimation(cardEl, card);
      // 同 handlePlayCard:提交 action 自己声明的 actionType(声明型主动技不是 'use')
      send(useAction.skillId, useAction.actionType, params);
      setSelectedCardId(null);
      setSelectedTarget(null);
    },
    [
      canOperate,
      isDistributeActive,
      isDiscardPhase,
      isPerspectiveAwaiting,
      transformMode,
      isMyAwaiting,
      isRespondTransformContext,
      pendingRespondInfo,
      respondNeedsTarget,
      handleRespond,
      isMyTurn,
      skillActions,
      view,
      perspectiveIdx,
      handListRef,
      send,
    ],
  );

  const handleCardClick = useCallback(
    (card: Card) => {
      // 选中手牌即退出主动技选目标模式(避免"技能选目标模式"与"出牌选目标"两套选择态并存)
      setPendingSkillAction(null);
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
      // 转化模式(优先于回应拦截:玩家主动进入转化模式,包括被询问杀时武圣转化杀打出)
      if (transformMode && canOperate && (isMyTurn || isRespondTransformContext)) {
        if (!transformMode.cardFilter(card)) return;
        if (transformMode.minCards > 1) {
          setSelectedCardId(null);
          setTransformMode(
            (prev) =>
              prev && {
                ...prev,
                selectedCardIds: toggleOrderedFifo(prev.selectedCardIds, card.id, prev.maxCards),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleDistToggle 定义在后面(const TDZ),其依赖 activeDistribute 已在本数组中
    [
      isDistributeActive,
      activeDistribute,
      isDiscardPhase,
      isPerspectiveAwaiting,
      canOperate,
      discardMax,
      isRespondTransformContext,
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
  }, [
    pending,
    isDiscardPhase,
    selectedForDiscard,
    discardMin,
    discardMax,
    send,
    pendingRespondInfo,
  ]);

  // ─── 多选快捷:全选 / 反选(弃牌阶段 + 多卡转化) ───
  // 弃牌阶段候选=整手牌;转化候选=cardFilter 命中的牌。两者均受各自 max 截断。
  const handleDiscardSelectAll = useCallback(() => {
    setSelectedForDiscard(
      selectAllOrdered(
        perspectiveHand.map((c) => c.id),
        discardMax,
      ),
    );
  }, [perspectiveHand, discardMax]);

  const handleDiscardInvert = useCallback(() => {
    setSelectedForDiscard((prev) =>
      invertOrdered(
        perspectiveHand.map((c) => c.id),
        prev,
        discardMax,
      ),
    );
  }, [perspectiveHand, discardMax]);

  const handleTransformSelectAll = useCallback(() => {
    setTransformMode((prev) => {
      if (!prev) return prev;
      const candidates = perspectiveHand.filter(prev.cardFilter);
      // 有组合约束(乱击:两张同花色)时选出一组**满足约束**的组合,
      // 否则「全选」会选中前 maxCards 张(可能不同花色)→ 提交被拦。
      if (prev.comboFilter) {
        for (let i = 0; i < candidates.length; i++) {
          for (let j = i + 1; j < candidates.length; j++) {
            if (prev.comboFilter([candidates[i], candidates[j]])) {
              return { ...prev, selectedCardIds: [candidates[i].id, candidates[j].id] };
            }
          }
        }
      }
      return {
        ...prev,
        selectedCardIds: selectAllOrdered(
          candidates.map((c) => c.id),
          prev.maxCards,
        ),
      };
    });
  }, [perspectiveHand]);

  const handleTransformInvert = useCallback(() => {
    setTransformMode((prev) => {
      if (!prev) return prev;
      const candidates = perspectiveHand.filter(prev.cardFilter).map((c) => c.id);
      return {
        ...prev,
        selectedCardIds: invertOrdered(candidates, prev.selectedCardIds, prev.maxCards),
      };
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
    setDistSelected(new Set(invertOrdered(activeDistribute.cardIds, [...distSelected], maxTotal)));
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
    setPendingSkillAction(null); // 退出主动技选目标模式(Esc / 取消选择)
  }, []);

  // ─── 提交派生(与 CenterActionBar 按钮 enabled 同源;Enter 快捷键复用)───
  // 转化:多卡(minCards>1)按选中数;单卡按 selectedCardId。回应路径(被询问杀)无需目标。
  const transformSubmit = (() => {
    if (!transformMode || isDistributeActive) return null;
    const ids =
      transformMode.minCards > 1
        ? transformMode.selectedCardIds
        : selectedCardId
          ? [selectedCardId]
          : [];
    const enough = ids.length >= transformMode.minCards && ids.length <= transformMode.maxCards;
    const comboOk = transformComboOk(ids);
    // 目标语义由产出牌的 use action 决定(酒无目标 / 桃 selfTarget / 杀 选目标)
    const needsTarget =
      !isRespondTransformContext &&
      (playRules
        ? playRules.needsTarget && !playRules.selfTarget
        : transformMode.targetFilter
          ? transformMode.targetFilter.max >= 1
          : true);
    // 产出牌门(与 CenterActionBar「使用」按钮同源):产出牌 use action 不 active 时
    // 不得提交——满血时界龙胆→桃方向按钮本就不亮,Enter 热键只看 canSubmit,也不得能发。
    const producedUsable = selectedActive || isRespondTransformContext;
    const canSubmit = producedUsable && enough && comboOk && (!needsTarget || !!selectedTarget);
    return { needsTarget, canSubmit };
  })();

  // distribute 提交:与 CenterActionBar 的三分支(select / 外部目标 / allocate)同源。
  const distSubmit = (() => {
    if (!activeDistribute) return null;
    const mode = activeDistribute.prompt.mode ?? 'allocate';
    const minTotal = activeDistribute.prompt.minTotal ?? 1;
    const maxTotal = activeDistribute.prompt.maxTotal ?? 99;
    if (mode === 'select') {
      return {
        canSubmit: distSelected.size >= minTotal && distSelected.size <= maxTotal,
        label: `确认(${distSelected.size})`,
      };
    }
    if (activeDistribute.externalTargetSelection) {
      return {
        canSubmit:
          distSelected.size >= minTotal && distSelected.size <= maxTotal && !!distTargetName,
        label: `确定(${distSelected.size})${distTargetName ? ` → ${distTargetName}` : ''}`,
      };
    }
    const total = distAllocations.flatMap((a) => a.cardIds).length;
    return { canSubmit: total >= minTotal, label: `提交分配(${total})` };
  })();

  const clearDiscard = useCallback(() => setSelectedForDiscard([]), []);

  return {
    selectedCardId,
    selectedTarget,
    selectedKillTarget,
    selectedMultiTargets,
    selectedForDiscard,
    transformMode,
    transformWrapperName,
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
    isRespondTransformContext,
    selectedRespondCardId,
    respondTargetName,
    respondTargets,
    respondNeedsTarget,
    respondTargetReady,
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
    skillTargetMode: pendingSkillAction !== null,
    clearRespondSelection,
    handleCardDoubleClick,
    transformSubmit,
    distSubmit,
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
  };
}
