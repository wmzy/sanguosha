// src/client/hooks/usePlayInteraction.ts
// 出牌交互状态机 hook(外壳,组合子 hook)。从 GameView.tsx 抽出。
//
// 结构(1593 行拆分为 4 个子 hook + 外壳,纯结构搬运,props/返回接口不变):
//   - usePlayInteraction/discard.ts    弃牌阶段交互(selectedForDiscard/确认/全选/反选/兜底)
//   - usePlayInteraction/respond.ts    回应窗口交互(回应选牌/目标/handleRespond 族)
//   - usePlayInteraction/transform.ts  转化技模式+提交(useTransformMode + useTransformSubmit)
//   - usePlayInteraction/distribute.ts distribute 分配/选牌(主动技 + 被动遗计)
//   - usePlayInteraction/orderedSelection.ts 有序多选共享工具(FIFO 淘汰/全选/反选)
//   - usePlayInteraction/common.ts     子 hook 共享的 PlaySend 类型
//
// 外壳保留(跨模式状态与派生):
//   - 出牌选中(selectedCardId/selectedTarget/selectedKillTarget/selectedMultiTargets)
//   - 主动技选目标模式(pendingSkillAction)、altAction 覆盖(altActionOverride)
//   - 派生量 selectedUseAction/selectedTargetFilter/playRules/selectedActive/
//     altActions/playButtonState(转化方向 transformWrapperName 来自 transform 子 hook,
//     但产出牌 use action 的查找与出牌路径共享,故派生留在外壳)
//   - 跨模式 dispatcher:handleCardClick/handleTargetClick/handleCardDoubleClick/
//     handleSkillAction/isTargetable(各模式分支委托对应子 hook)
//
// 子 hook 挂载顺序约束:useTransformMode(状态+方向)必须先于 selectedUseAction/playRules
// 派生;useTransformSubmit 消费这些派生量,必须在其后(详见 transform.ts 头注)。
//
// 不管理:手牌拖拽重排(useHandReorder)、视角切换、WS 连接。

import { useState, useCallback, useEffect, useMemo, type RefObject } from 'react';
import type {
  ActionPrompt,
  Card,
  GameView,
  Json,
  DistributePrompt,
  PendingView,
} from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import {
  getPendingRequestedName,
  type PendingRespondInfo,
} from '../utils/pendingRespond';

import {
  buildPlayParams,
  derivePlayRules,
  findUseActionForCard,
  findAltActionsForCard,
  isActiveAction,
  isFreePlayWindow,
  extractCardFilter,
  ownEquipCards,
  choosePlayerCandidates,
  selectTargetCandidates,
  distributeAllocateCandidates,
  effectiveTargetCard,
  promptTargetBounds,
} from '../utils/gameViewHelpers';
import { createCardFlyAnimation } from '../utils/cardFlyAnimation';
import { targetCandidates, targetSelectionBounds, toggleTargetSelection, validateTargetSelection } from '../../engine/rules/target-selection';
import { useDiscardInteraction } from './usePlayInteraction/discard';
import { useRespondInteraction } from './usePlayInteraction/respond';
import {
  useTransformMode,
  useTransformSubmit,
  type TransformMode,
} from './usePlayInteraction/transform';
import {
  useDistributeInteraction,
  type ActiveDistribute,
} from './usePlayInteraction/distribute';

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
  // 解析与无头 availableActions 共享 getPendingRequestedName(原两处逐字重复);
  // 此处仅叠加浏览器侧闸门:仅本视角被询问(isMyAwaiting)时生效。
  const pendingRequestedName = isMyAwaiting ? getPendingRequestedName(pending, perspectiveIdx) : null;

  /** 转化技回应上下文:当前 pending 请求的牌名与转化后的牌名一致 → 转化牌走 R.respond 路径。
   *  覆盖 杀(武圣/丈八蛇矛/龙胆/界龙胆:南蛮/决斗/激将)、闪(倾国/龙胆:被杀指定)、
   *  无懈可击(看破:广播窗口)等所有"被要求打出某牌"的窗口。
   *  此前只认 杀(询问杀 / 请求回应 杀/respondKill)→ 倾国/看破/龙胆的闪侧整类无法回应。 */
  const isRespondTransformContext =
    pendingRequestedName !== null &&
    !!pending &&
    (pending.target === perspectiveIdx || pending.target < 0);

  // ─── 状态(外壳:出牌选中 + 主动技选目标)───
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
  // altAction 覆盖:用户点击替代 use action(如断粮)按钮后,用它覆盖默认 selectedUseAction,
  // 使后续选目标 + 提交走该 action 而非主 use action(如杀)。选中牌变化/提交后清除。
  const [altActionOverride, setAltActionOverride] = useState<SkillActionDef | null>(null);

  const perspectiveEquipment = useMemo(
    () => view.players[perspectiveIdx]?.equipment ?? {},
    [view.players, perspectiveIdx],
  );

  const nameToIndex = useCallback(
    (name: string): number => {
      return view.players.findIndex((pl) => pl.name === name);
    },
    [view.players],
  );

  // ─── 子 hook 组合(各自的 state/reset effect 已随迁)───
  // 弃牌阶段交互
  const discard = useDiscardInteraction({
    pending,
    isDiscardPhase,
    discardMin,
    discardMax,
    perspectiveHand,
    pendingRespondInfo,
    send,
  });
  const {
    selectedForDiscard,
    toggleDiscardCard,
    handleConfirmDiscard,
    handleDiscardSelectAll,
    handleDiscardInvert,
    clearDiscard,
  } = discard;

  // 回应窗口交互(弃牌窗口的回应分支委托 discard)
  const respond = useRespondInteraction({
    view,
    perspectiveIdx,
    perspectiveHand,
    pending,
    isMyAwaiting,
    isDiscardPhase,
    pendingRespondInfo,
    pendingTargetIdx,
    broadcastKey,
    markBroadcastSkipped,
    send,
    discardRespond: discard.respondInDiscardWindow,
  });
  const {
    selectedRespondCardId,
    respondTargetName,
    respondTargets,
    respondTargetFilter,
    respondNeedsTarget,
    respondCard,
    respondTargetReady,
    handleRespond,
    handlePlayRespond,
    clearRespondSelection,
    handleCardClick: handleRespondCardClick,
    handleCardDoubleClick: handleRespondCardDoubleClick,
    toggleSeatTarget: toggleRespondSeatTarget,
  } = respond;

  // 转化模式(状态 + 方向派生;先于下方 selectedUseAction/playRules 派生挂载)
  const transformModeState = useTransformMode({
    view,
    perspectiveIdx,
    perspectiveHand,
    perspectiveEquipment,
    skillActions,
    selectedCardId,
    setSelectedCardId,
    setSelectedTarget,
  });
  const {
    transformMode,
    setTransformMode,
    transformWrapperName,
    handleModeCardClick,
    handleTransformSelectAll,
    handleTransformInvert,
    cancelTransform,
  } = transformModeState;

  // distribute(主动技 + 被动遗计)
  const distribute = useDistributeInteraction({
    view,
    perspectiveIdx,
    perspectiveHand,
    perspectiveEquipment,
    skillActions,
    pending,
    isMyAwaiting,
    pendingRespondInfo,
    send,
    nameToIndex,
  });
  const { activeDistribute, isDistributeActive, setDistributeMode } = distribute;
  const {
    distSelected,
    distAllocations,
    distTargetName,
    distExternalCandidates,
    handleDistToggle,
    handleDistSelectAll,
    handleDistInvert,
    handleDistAllocate,
    handleDistSubmit,
    handleDistClear,
    handleSeatClick: handleDistSeatClick,
    distSubmit,
  } = distribute;

  // ─── state 重置 effects(外壳自有选中态;子 hook 的重置 effect 已随迁)───
  useEffect(() => {
    setSelectedKillTarget(null);
  }, [selectedCardId]);
  // 换牌时清空多目标集合(与 selectedKillTarget 同源,覆盖所有选牌/重置路径)
  useEffect(() => {
    setSelectedMultiTargets([]);
  }, [selectedCardId]);

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

  // (转化方向 transformWrapperName 由 transform 子 hook 派生,方向随选牌;
  //  方向求值与无头枚举共享 producedNameOf,见 transform.ts。)
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

  // 转化提交逻辑:消费上方 playRules/selectedActive 派生,必须在其后挂载(见 transform.ts 头注)
  const { handleTransformPlay, transformSubmit } = useTransformSubmit({
    transformMode,
    setTransformMode,
    transformWrapperName,
    perspectiveIdx,
    perspectiveHand,
    perspectiveEquipment,
    cardMap: view.cardMap,
    playRules,
    selectedActive,
    selectedCardId,
    selectedTarget,
    isDistributeActive,
    isRespondTransformContext,
    pendingRequestedName,
    send,
    nameToIndex,
    setSelectedCardId,
    setSelectedTarget,
  });

  // ─── handlers ───
  /** 变体声明的额外代价牌(如强袭·弃武器需要一张武器牌)填入 params.cardId:
   *  优先当前选中的手牌(须满足变体 cardFilter),否则自己的装备区武器。
   *  装备区解析与无头枚举(costCardsOf/ownMaterialCards)共享 ownEquipCards。
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
      const equipCard = ownEquipCards(perspectiveEquipment, view.cardMap, filter)[0];
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
          // 候选解析与无头枚举共享 selectTargetCandidates(存活 + allowSelf + filter)
          return selectTargetCandidates(view, perspectiveIdx, p).includes(i);
        }
        if (p.type === 'choosePlayer') {
          // 候选解析与无头枚举共享 choosePlayerCandidates(candidates 优先,filter 兜底)
          return choosePlayerCandidates(view, p).includes(i);
        }
      }
      if (isDistributeActive && activeDistribute) {
        const mode = activeDistribute.prompt.mode ?? 'allocate';
        // 制衡(select)无目标选择
        if (mode === 'select') return false;
        // 候选判定与无头枚举/distribute 点座位共享 distributeAllocateCandidates
        // (存活 + allowSelf + targetFilter)
        return distributeAllocateCandidates(view, perspectiveIdx, activeDistribute.prompt).includes(i);
      }
      const tf = isMyAwaiting && respondTargetFilter ? respondTargetFilter : selectedTargetFilter;
      if (!tf) return !!view.players[i]?.alive;
      const names = playRules?.hasSlots || playRules?.multiTarget
        ? selectedMultiTargets.length ? selectedMultiTargets : [selectedTarget, selectedKillTarget].filter((name): name is string => name !== null)
        : selectedTarget ? [selectedTarget] : [];
      const selected = isMyAwaiting && respondTargetFilter ? respondTargets : names.map((name) => view.players.findIndex((player) => player.name === name));
      if (selected.includes(i)) return true;
      // 目标约束的 card 参数与无头枚举共享 effectiveTargetCard(杀的动态目标上限
      // 只对「正在使用的牌」生效,代价牌不算,判据见该函数);回应窗口用的则是
      // 正在打出的牌(respondCard)。usedCardName:转化技传产出牌名;普通出牌
      // 按「use action 的 skillId 就是选中牌名」认定选中牌为使用牌;代价牌 null。
      const usedCardName = transformWrapperName
        ?? (selectedUseAction && selectedUseAction.skillId === selectedCard?.name
          ? selectedCard.name
          : null);
      const card = isMyAwaiting && respondTargetFilter
        ? respondCard
        : effectiveTargetCard(selectedCard, selectedTargetFilter, usedCardName);
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

  /** 出牌提交三连:捕卡(飞行动画定位)→ 飞行动画 → send → 清空选中。
   *  在牌元素消失前捕获位置;提交后清空选中,否则牌飞走、离开手牌后 selectedCardId
   *  仍指向它 →「取消选择」残留却无牌高亮。原在 handlePlayCard/handleCardDoubleClick
   *  各手写一份逐字重复。 */
  const submitWithFly = useCallback(
    (
      card: Card,
      skillId: string,
      actionType: string,
      params: Record<string, Json>,
    ) => {
      const cardEl = handListRef.current?.querySelector(
        `[data-card-id="${card.id}"]`,
      ) as HTMLElement | null;
      if (cardEl) createCardFlyAnimation(cardEl, card);
      send(skillId, actionType, params);
      setSelectedCardId(null);
      setSelectedTarget(null);
    },
    [handListRef, send],
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
    // actionType 用 action 自己声明的(而非硬编码 'use'):声明型主动技(蛊惑/界蛊惑)把
    // 声明编码进 actionType(`use:杀`),硬编码 'use' 会让引擎侧找不到 action 条目 → 恒拒。
    submitWithFly(card, selectedUseAction.skillId, selectedUseAction.actionType, params);
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
    submitWithFly,
  ]);

  const handleTargetClick = useCallback(
    (name: string) => {
      const idx = view.players.findIndex((pl) => pl.name === name);
      if (idx >= 0 && !isTargetable(idx)) return;
      // 主动技选目标模式:单选技能(挑衅/强袭/反间 等 max=1)点座位即提交,无需再点按钮
      if (pendingSkillAction) {
        const p = pendingSkillAction.action.prompt;
        const { max: maxTargets } = promptTargetBounds(p);
        if (maxTargets <= 1) {
          submitSkillTarget(pendingSkillAction.action, name, pendingSkillAction.params);
          return;
        }
      }
      if (isDistributeActive && activeDistribute) {
        // distribute 模式点座位(外部目标选择 toggle / 内部 allocate 分配)归 distribute 子 hook
        handleDistSeatClick(name, idx);
        return;
      }
      // respond 模式 useCardAndTarget(借刀杀人/出杀):点目标 toggle 选中,与出牌阶段 selectedTarget 独立
      // (不依赖 selectedCardId/selectedUseAction,respond 时两者均空)。
      if (isMyAwaiting && respondTargetFilter) {
        toggleRespondSeatTarget(idx);
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
      pendingSkillAction,
      submitSkillTarget,
      isDistributeActive,
      activeDistribute,
      handleDistSeatClick,
      isMyAwaiting,
      respondTargetFilter,
      toggleRespondSeatTarget,
      playRules,
      selectedMultiTargets,
      selectedCard,
      transformWrapperName,
      selectedTarget,
      selectedKillTarget,
      view,
      perspectiveIdx,
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
        const { max: maxTargets } = promptTargetBounds(prompt);
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
    [
      selectedCardId,
      selectedTarget,
      nameToIndex,
      perspectiveHand,
      send,
      submitSkillTarget,
      setTransformMode,
      setDistributeMode,
    ],
  );

  const handleEndTurn = useCallback(() => {
    if (!isMyTurn) return;
    send('回合管理', 'end', {});
  }, [isMyTurn, send]);

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
      // 回应窗口:双击语义归 respond 子 hook(可回应牌直接打出;需目标的退化为选中)。
      // 转化回应路径(询问杀/闪/无懈)的拦截由上方 `if (transformMode) return` 承担。
      if (isMyAwaiting) {
        handleRespondCardDoubleClick(card);
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
      // 同 handlePlayCard:提交 action 自己声明的 actionType(声明型主动技不是 'use')
      submitWithFly(card, useAction.skillId, useAction.actionType, params);
    },
    [
      canOperate,
      isDistributeActive,
      isDiscardPhase,
      isPerspectiveAwaiting,
      transformMode,
      isMyAwaiting,
      handleRespondCardDoubleClick,
      isMyTurn,
      skillActions,
      view,
      perspectiveIdx,
      submitWithFly,
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
        toggleDiscardCard(card.id);
        return;
      }
      // 转化模式(优先于回应拦截:玩家主动进入转化模式,包括被询问杀时武圣转化杀打出)
      if (transformMode && canOperate && (isMyTurn || isRespondTransformContext)) {
        handleModeCardClick(card);
        return;
      }
      // 回应模式:点牌只选中(高亮),不直接出牌;再点同一张取消选中。
      // 真正出牌由「打出」按钮(handlePlayRespond)触发,避免误触。求桃/无懈可击同此路径。
      if (isMyAwaiting) {
        handleRespondCardClick(card);
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
      handleDistToggle,
      isDiscardPhase,
      isPerspectiveAwaiting,
      canOperate,
      toggleDiscardCard,
      transformMode,
      isMyTurn,
      isRespondTransformContext,
      handleModeCardClick,
      isMyAwaiting,
      handleRespondCardClick,
      selectedCardId,
    ],
  );

  const cancelSelection = useCallback(() => {
    setSelectedCardId(null);
    setSelectedTarget(null);
    setPendingSkillAction(null); // 退出主动技选目标模式(Esc / 取消选择)
  }, []);

  return {
    selectedCardId,
    selectedTarget,
    selectedKillTarget,
    selectedMultiTargets,
    selectedForDiscard,
    transformMode,
    transformWrapperName,
    distributeMode: distribute.distributeMode,
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
