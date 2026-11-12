// src/client/hooks/usePlayInteraction/transform.ts
// 转化技交互子 hook(从 usePlayInteraction.ts 拆出,纯结构搬运)。
// 职责:
//   - 转化模式状态 transformMode(武圣/丈八蛇矛/龙胆…进入后的选牌模式)
//     + 自动取消 effect(转化条件不再满足时退出,避免玩家卡死)
//   - 转化方向派生 transformWrapperName(由**当前选中的牌**决定,多向转化技不钉死方向)
//   - 模式内点牌 / 全选 / 反选 / 取消
//   - 转化提交 handleTransformPlay(回应路径 R.respond + 自由出牌路径 R.use,
//     均带 preceding transform)与提交派生 transformSubmit
//
// 拆成两个 hook 的原因(真实交叉耦合的解法,非可选):转化方向 transformWrapperName
// 参与外壳的 selectedUseAction → playRules/selectedActive 派生(产出牌的目标语义与
// active 门),而提交逻辑又消费这两个派生量。单向数据流要求:
//   useTransformMode(状态+方向)→ 外壳派生 → useTransformSubmit(提交)。
// 两者的调用顺序由外壳保证(mode 在前、submit 在派生之后)。
//
// 模式的**进入**不在此处:入口在外壳 handleSkillAction 的 useCard/useCardAndTarget
// transform 分支(经 setTransformMode 注入,构造逻辑随 switch 分支留在外壳)。

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  Card,
  CardWrapper,
  EquipSlot,
  GameView,
  Json,
  TargetFilter,
} from '../../../engine/types';
import type { SkillActionDef } from '../../skillActionRegistry';
import type { PlayRules } from '../../utils/gameViewHelpers';
import {
  buildShadowCardId,
  comboSatisfied,
  isActiveAction,
  producedNameOf,
  resolveOwnCard,
} from '../../utils/gameViewHelpers';
import type { PlaySend } from './common';
import { invertOrdered, selectAllOrdered, toggleOrderedFifo } from './orderedSelection';

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

export interface TransformModeParams {
  view: GameView;
  perspectiveIdx: number;
  perspectiveHand: Card[];
  perspectiveEquipment: Partial<Record<EquipSlot, string>>;
  /** 当前视角玩家的技能 actions(自动取消 effect 查 active 用) */
  skillActions: SkillActionDef[];
  /** 外壳单卡转化模式下选中的原料牌 id */
  selectedCardId: string | null;
  /** 外壳出牌选中态 setter(模式内点牌/取消时联动清空/切换) */
  setSelectedCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedTarget: Dispatch<SetStateAction<string | null>>;
}

export interface TransformModeInteraction {
  transformMode: TransformMode | null;
  /** 模式注入(外壳 handleSkillAction 的 transform 分支构造 TransformMode 后进入) */
  setTransformMode: Dispatch<SetStateAction<TransformMode | null>>;
  /** 当前转化方向的产出牌名(由选中的牌决定;未选牌时为进入模式时的样本名)。
   *  按钮文案与主 action 查找都用它——多向转化技的方向必须跟随选牌。 */
  transformWrapperName: string | null;
  /** 转化模式内点牌(外壳 handleCardClick 的转化分支,已判 canOperate/回合或回应上下文) */
  handleModeCardClick: (card: Card) => void;
  /** 多卡转化:全选(截断到 maxCards) */
  handleTransformSelectAll: () => void;
  /** 多卡转化:反选(超 maxCards 时按 FIFO 取尾部) */
  handleTransformInvert: () => void;
  cancelTransform: () => void;
}

export function useTransformMode(p: TransformModeParams): TransformModeInteraction {
  const {
    view,
    perspectiveIdx,
    perspectiveHand,
    perspectiveEquipment,
    skillActions,
    selectedCardId,
    setSelectedCardId,
    setSelectedTarget,
  } = p;

  const [transformMode, setTransformMode] = useState<TransformMode | null>(null);

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
  }, [transformMode, view, perspectiveIdx, skillActions, setSelectedCardId, setSelectedTarget]);

  // 转化方向 = 当前选中牌的产出牌名(而非进入模式时手牌里第一张匹配牌的产出名)。
  // 未选牌时回退到进入模式时的样本名(仅用于按钮文案占位)。
  // 方向求值与无头枚举共享 producedNameOf;原料解析(手牌∪装备区)共享 resolveOwnCard。
  const transformWrapperName = (() => {
    if (!transformMode) return null;
    const ids =
      transformMode.minCards > 1
        ? transformMode.selectedCardIds
        : selectedCardId
          ? [selectedCardId]
          : [];
    if (ids.length === 0 || !transformMode.transform) return transformMode.wrapperName;
    const card = resolveOwnCard(perspectiveHand, perspectiveEquipment, view.cardMap, ids[0]);
    if (!card || !transformMode.cardFilter(card)) return transformMode.wrapperName;
    return producedNameOf(transformMode.transform, card);
  })();

  /** 转化模式内点牌(外壳 handleCardClick 的转化分支原样搬入;转化优先于回应拦截:
   *  玩家主动进入转化模式,包括被询问杀时武圣转化杀打出)。
   *  多卡模式 toggle selectedCardIds(FIFO);单卡模式切换 selectedCardId。 */
  const handleModeCardClick = useCallback(
    (card: Card) => {
      if (!transformMode) return;
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
    },
    [transformMode, selectedCardId, setSelectedCardId, setSelectedTarget],
  );

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

  const cancelTransform = useCallback(() => {
    setTransformMode(null);
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, [setSelectedCardId, setSelectedTarget]);

  return {
    transformMode,
    setTransformMode,
    transformWrapperName,
    handleModeCardClick,
    handleTransformSelectAll,
    handleTransformInvert,
    cancelTransform,
  };
}

export interface TransformSubmitParams {
  transformMode: TransformMode | null;
  setTransformMode: Dispatch<SetStateAction<TransformMode | null>>;
  transformWrapperName: string | null;
  perspectiveIdx: number;
  perspectiveHand: Card[];
  perspectiveEquipment: Partial<Record<EquipSlot, string>>;
  cardMap: Record<string, Card>;
  /** 外壳按产出牌 use action 求值的派生量(目标语义/active 门) */
  playRules: PlayRules | null;
  selectedActive: boolean;
  /** 外壳单卡转化模式下选中的原料牌 id */
  selectedCardId: string | null;
  selectedTarget: string | null;
  /** distribute 激活时转化提交按钮不可用(与 CenterActionBar 同源) */
  isDistributeActive: boolean;
  /** 转化技回应上下文:pending 请求的牌名 = 转化后牌名 → 走 R.respond 路径 */
  isRespondTransformContext: boolean;
  /** 回应窗口请求的牌名(询问X → X / 请求回应 'R/...' → R) */
  pendingRequestedName: string | null;
  send: PlaySend;
  nameToIndex: (name: string) => number;
  setSelectedCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedTarget: Dispatch<SetStateAction<string | null>>;
}

export interface TransformSubmitInteraction {
  /** 多卡转化的组合约束校验(乱击/界乱击:两张同花色) */
  transformComboOk: (ids: string[]) => boolean;
  handleTransformPlay: (targetName: string) => void;
  /** 转化提交派生(与 CenterActionBar「使用」按钮同源,Enter 快捷键复用) */
  transformSubmit: { needsTarget: boolean; canSubmit: boolean } | null;
}

export function useTransformSubmit(p: TransformSubmitParams): TransformSubmitInteraction {
  const {
    transformMode,
    setTransformMode,
    transformWrapperName,
    perspectiveIdx,
    perspectiveHand,
    perspectiveEquipment,
    cardMap,
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
  } = p;

  /** 多卡转化的组合约束校验(乱击/界乱击:两张同花色)。
   *  选中牌先查手牌,再查自己装备区(cardMap)——界父魂 的多卡转化原料含装备区。
   *  缺 comboFilter 时恒真(丈八蛇矛/界父魂 任意两张)。
   *  判据与无头枚举共享 comboSatisfied + resolveOwnCard(原两处各自实现)。 */
  const transformComboOk = useCallback(
    (ids: string[]): boolean =>
      comboSatisfied(
        transformMode?.comboFilter,
        (id) => resolveOwnCard(perspectiveHand, perspectiveEquipment, cardMap, id),
        ids,
      ),
    [transformMode, perspectiveHand, perspectiveEquipment, cardMap],
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
          const shadowCardId = buildShadowCardId(ids, transformMode.skillId);
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
        const shadowCardId = buildShadowCardId(selectedCardId, transformMode.skillId);
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
        const shadowCardId = buildShadowCardId(ids, transformMode.skillId);
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
        const shadowCardId = buildShadowCardId(selectedCardId, transformMode.skillId);
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
      setTransformMode,
      setSelectedCardId,
      setSelectedTarget,
    ],
  );

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

  return { transformComboOk, handleTransformPlay, transformSubmit };
}
