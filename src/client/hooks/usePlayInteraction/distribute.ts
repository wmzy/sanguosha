// src/client/hooks/usePlayInteraction/distribute.ts
// distribute(分配/选牌)交互子 hook(从 usePlayInteraction.ts 拆出,纯结构搬运)。
// 职责:
//   - distribute 模式状态(distributeMode/distSelected/distAllocations/distTargetName)
//     + distKey 切换重置 effect + 主动技自动取消 effect(action 不再 active 时清态)
//   - distribute 上下文派生 activeDistribute(主动技 + 被动遗计统一)与外部候选牌
//   - 选牌 toggle/全选/反选、分配(点座位)、提交/清空、提交派生 distSubmit
//   - distribute 模式点座位分支(外壳 handleTargetClick 委托)
// 不管理:出牌选中(selectedCardId)——进入 distribute 模式时由外壳清空。

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  Card,
  DistributePrompt,
  EquipSlot,
  GameView,
  PendingView,
} from '../../../engine/types';
import type { SkillActionDef } from '../../skillActionRegistry';
import type { PendingRespondInfo } from '../../utils/pendingRespond';
import {
  isActiveAction,
  resolveDistributeCardIds,
  distributeAllocateCandidates,
} from '../../utils/gameViewHelpers';
import type { PlaySend } from './common';
import { invertOrdered, selectAllOrdered } from './orderedSelection';

/** distribute 上下文(主动技 + 被动遗计统一) */
export interface ActiveDistribute {
  skillId: string;
  actionType: string;
  prompt: DistributePrompt;
  cardIds: string[];
  externalTargetSelection: boolean;
}

export interface DistributeInteractionParams {
  view: GameView;
  perspectiveIdx: number;
  perspectiveHand: Card[];
  perspectiveEquipment: Partial<Record<EquipSlot, string>>;
  /** 当前视角玩家的技能 actions(主动技自动取消 effect 查 active 用) */
  skillActions: SkillActionDef[];
  /** pending 原始对象(可能 null;被动遗计分支用) */
  pending: PendingView | null;
  /** 是否当前视角在等待回应(阻塞型)且可操作(isPerspectiveAwaiting && canOperate) */
  isMyAwaiting: boolean;
  /** 已 resolve 的 respond 信息(usePendingState memo 后传入;被动遗计分支取 skillId) */
  pendingRespondInfo: PendingRespondInfo | null;
  send: PlaySend;
  nameToIndex: (name: string) => number;
}

export interface DistributeInteraction {
  distributeMode: { skillId: string; actionType: string; prompt: DistributePrompt } | null;
  setDistributeMode: Dispatch<
    SetStateAction<{ skillId: string; actionType: string; prompt: DistributePrompt } | null>
  >;
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
  handleDistToggle: (id: string) => void;
  /** distribute select 模式(制衡):全选所有候选,截断到 maxTotal */
  handleDistSelectAll: () => void;
  /** distribute select 模式(制衡):反选,取候选中未选的,超 maxTotal 取尾部 */
  handleDistInvert: () => void;
  handleDistAllocate: (targetIdx: number) => void;
  handleDistSubmit: () => void;
  handleDistClear: () => void;
  /** distribute 模式点座位(外壳 handleTargetClick 的 distribute 分支):
   *  外部目标选择(仁德)toggle 目标名;内部 allocate(遗计)把当前选中牌分配给该玩家。 */
  handleSeatClick: (name: string, idx: number) => void;
  /** distribute 提交派生(与 CenterActionBar 提交按钮同源,Enter 快捷键复用) */
  distSubmit: { canSubmit: boolean; label: string } | null;
}

export function useDistributeInteraction(p: DistributeInteractionParams): DistributeInteraction {
  const {
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
  } = p;

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

  // state 重置 effect(随迁):distribute 上下文切换(skillId:actionType:mode)时清空三态
  const distKey = activeDistribute
    ? `${activeDistribute.skillId}:${activeDistribute.actionType}:${activeDistribute.prompt.mode ?? 'allocate'}`
    : '';
  useEffect(() => {
    setDistSelected(new Set());
    setDistAllocations([]);
    setDistTargetName(null);
  }, [distKey]);

  // distribute(主动技)自动取消:distributeMode 对应的 action 不再 active 时
  // (如出牌阶段超时回合结束、视角切换、制衡/仁德限一次已用),清除 distribute 选择状态,
  // 避免玩家卡在无法提交的 UI。与 transformMode 自动取消逻辑对称。
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

  /** distribute 模式点座位(外壳 handleTargetClick 的 distribute 分支原样搬入)。 */
  const handleSeatClick = useCallback(
    (name: string, idx: number) => {
      if (!activeDistribute) return;
      const mode = activeDistribute.prompt.mode ?? 'allocate';
      // 制衡(select)无目标,座位点击忽略
      if (mode === 'select') return;
      if (activeDistribute.externalTargetSelection) {
        // 仁德:点玩家设为目标(可选性与外壳 isTargetable/无头枚举共享
        // distributeAllocateCandidates:存活 + allowSelf + targetFilter)
        if (!distributeAllocateCandidates(view, perspectiveIdx, activeDistribute.prompt).includes(idx)) {
          return;
        }
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
    },
    [activeDistribute, perspectiveIdx, distTargetName, distSelected, view],
  );

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

  return {
    distributeMode,
    setDistributeMode,
    activeDistribute,
    isDistributeActive,
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
    handleSeatClick,
    distSubmit,
  };
}
