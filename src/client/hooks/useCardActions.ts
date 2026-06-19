// src/client/hooks/useCardActions.ts
// 出牌/回应/转化逻辑 hook。从 GameView.tsx 提取,封装卡牌操作的业务逻辑。
//
// 设计原则:
// - hook 返回操作函数(handlePlayCard/handleRespond/handleTransformPlay)
// - hook 返回查询函数(deriveCardFilterFromAtom/pendingRespondInfo)
// - hook 内部管理转化模式状态(transformMode)
// - 调用方负责渲染,不关心操作细节

import { useState, useCallback } from 'react';
import type { Card, Json, PendingView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import { findActionAcrossOwners } from '../skillActionRegistry';
import { TARGET_REQUIRED_CARDS, TWO_TARGET_CARDS, SELF_TARGET_CARDS, RESPOND_ONLY_CARDS, isDelayedTrick } from '../../engine/card-meta';

// ─── 类型 ───

interface ActionMsg {
  skillId: string;
  actionType: string;
  ownerId: number;
  params: Record<string, Json>;
  preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>;
}

export interface TransformMode {
  skillId: string;
  actionType: string;
  cardFilter: (c: Card) => boolean;
  wrapperName: string;
}

export interface RespondInfo {
  skillId: string;
  cardFilter?: (c: Card) => boolean;
}

// ─── 纯函数:从 atom 推导 cardFilter ───

/** 从 SkillActionDef 的 prompt 提取 cardFilter 函数 */
function extractCardFilterFromAction(action: SkillActionDef): ((c: Card) => boolean) | undefined {
  const p = action.prompt;
  if ((p.type === 'useCard' || p.type === 'useCardAndTarget') && 'cardFilter' in p && p.cardFilter?.filter) {
    return p.cardFilter.filter;
  }
  return undefined;
}

/** 从 atom 类型本地构造 cardFilter 函数(不依赖 registry) */
export function deriveCardFilterFromAtom(atomType: string, reqType: string): ((c: Card) => boolean) | undefined {
  if (atomType.startsWith('询问')) {
    const cardName = atomType.slice(2);
    if (!cardName) return undefined;
    return (c) => c.name === cardName;
  }
  if (atomType === '请求回应' || atomType === '并行回应') {
    if (!reqType) return undefined;
    if (reqType === '__弃牌') return () => true;
    const slashIdx = reqType.indexOf('/');
    const cardName = slashIdx >= 0 ? reqType.slice(0, slashIdx) : reqType;
    if (!cardName) return undefined;
    return (c) => c.name === cardName;
  }
  return undefined;
}

// ─── Hook ───

interface UseCardActionsOptions {
  pending: PendingView | null;
  pendingTargetIdx: number;
  isDiscardPhase: boolean;
  discardMin: number;
  perspectiveIdx: number;
  perspectiveHand: Card[];
  skillActions: SkillActionDef[];
  onAction: (action: ActionMsg) => void;
}

export function useCardActions({
  pending,
  pendingTargetIdx,
  isDiscardPhase,
  discardMin,
  perspectiveIdx,
  perspectiveHand,
  skillActions,
  onAction,
}: UseCardActionsOptions) {
  const [transformMode, setTransformMode] = useState<TransformMode | null>(null);
  const [skippedBroadcast, setSkippedBroadcast] = useState<Set<string>>(new Set());

  // 发送 action
  const send = useCallback(
    (skillId: string, actionType: string, params: Record<string, Json>, preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>) => {
      onAction({ skillId, actionType, ownerId: perspectiveIdx, params, preceding });
    },
    [onAction, perspectiveIdx],
  );

  // 从 registry 查找 respond action
  const findRespondAction = useCallback((skillId: string): SkillActionDef | undefined => {
    const own = skillActions.find(a => a.skillId === skillId && a.actionType === 'respond');
    if (own) return own;
    return findActionAcrossOwners(skillId, 'respond');
  }, [skillActions]);

  // 推导当前 pending 的 respond 信息
  const pendingRespondInfo = useCallback((): RespondInfo | null => {
    if (!pending) return null;
    const atom = pending.atom as Record<string, unknown>;
    const atomType = pending.atom?.type ?? '';
    const reqType = typeof atom['requestType'] === 'string' ? (atom['requestType'] as string) : '';

    let skillId: string | null = null;
    if (atomType.startsWith('询问')) {
      skillId = atomType.slice(2);
    } else if (reqType === '__弃牌') {
      skillId = '系统规则';
    } else if (atomType === '请求回应' || atomType === '并行回应') {
      if (!reqType) return null;
      skillId = reqType.includes('/') ? reqType.slice(0, reqType.indexOf('/')) : (reqType || null);
    }
    if (!skillId) return null;

    const action = findRespondAction(skillId);
    const registryFilter = action ? extractCardFilterFromAction(action) : undefined;
    const localFilter = deriveCardFilterFromAtom(atomType, reqType);
    const cardFilter = registryFilter ?? localFilter;

    return { skillId, cardFilter };
  }, [pending, findRespondAction]);

  // 回应
  const handleRespond = useCallback((cardId?: string, selectedForDiscard?: Set<string>) => {
    if (!pending) return;
    if (isDiscardPhase) {
      // 弃牌窗口由调用方处理
      return 'discard' as const;
    }
    const info = pendingRespondInfo();
    if (!info) return;
    if (cardId) {
      const card = perspectiveHand.find(c => c.id === cardId);
      if (!card) return;
      if (info.cardFilter && !info.cardFilter(card)) return;
      send(info.skillId, 'respond', { cardId });
    } else if (pendingTargetIdx < 0) {
      setSkippedBroadcast(prev => new Set(prev).add(pending!.atom?.type + ':' + (pending!.atom as { requestType?: string }).requestType));
    } else {
      send(info.skillId, 'respond', {});
    }
    return 'sent' as const;
  }, [pending, isDiscardPhase, pendingRespondInfo, perspectiveHand, send, pendingTargetIdx]);

  // 出牌
  const handlePlayCard = useCallback((
    selectedCardId: string | null,
    selectedTarget: string | null,
    selectedKillTarget: string | null,
    players: Array<{ name: string }>,
  ) => {
    if (!selectedCardId) return;
    const card = perspectiveHand.find(c => c.id === selectedCardId);
    if (!card) return;
    if (RESPOND_ONLY_CARDS.has(card.name)) return;
    const selfName = players[perspectiveIdx]?.name ?? '';
    const needsTarget = TARGET_REQUIRED_CARDS.has(card.name);
    const needsTwoTargets = TWO_TARGET_CARDS.has(card.name);
    if (needsTarget && !selectedTarget) return;
    if (needsTwoTargets && (!selectedTarget || !selectedKillTarget)) return;
    const targetName = selectedTarget ?? (SELF_TARGET_CARDS.has(card.name) ? selfName : undefined);
    const params: Record<string, Json> = { cardId: card.id };
    if (targetName) {
      const idx = players.findIndex(p => p.name === targetName);
      if (idx >= 0) {
        if (needsTwoTargets) {
          params.target = idx;
          if (selectedKillTarget) {
            const kIdx = players.findIndex(p => p.name === selectedKillTarget);
            if (kIdx >= 0) params.killTarget = kIdx;
          }
        } else if (isDelayedTrick(card)) {
          params.target = idx;
        } else {
          params.targets = [idx];
        }
      }
    }
    const skillId = card.type === '装备牌' ? '装备通用' : card.name;
    send(skillId, 'use', params);
    return { card, skillId };
  }, [perspectiveIdx, perspectiveHand, send]);

  // 转化模式出牌
  const handleTransformPlay = useCallback((
    targetName: string,
    selectedCardId: string | null,
    players: Array<{ name: string }>,
  ) => {
    if (!transformMode || !selectedCardId) return;
    const targetCard = perspectiveHand.find(c => c.id === selectedCardId);
    if (!targetCard) return;
    const idx = players.findIndex(p => p.name === targetName);
    if (idx < 0) return;
    const shadowCardId = `${selectedCardId}#${transformMode.skillId}`;
    send(transformMode.wrapperName, 'use', { cardId: shadowCardId, targets: [idx] }, [{
      skillId: transformMode.skillId,
      actionType: transformMode.actionType,
      params: { cardId: selectedCardId },
    }]);
    setTransformMode(null);
    return true;
  }, [transformMode, perspectiveHand, send]);

  // 进入转化模式
  const enterTransformMode = useCallback((action: SkillActionDef) => {
    const { skillId, actionType, prompt } = action;
    if (!action.transform) return;
    if (prompt.type !== 'useCardAndTarget' && prompt.type !== 'useCard') return;
    if (!('cardFilter' in prompt) || !prompt.cardFilter?.filter) return;
    const filter = prompt.cardFilter.filter;
    const sample = perspectiveHand.find(c => filter(c));
    const wrapperName = sample ? action.transform(sample).name : skillId;
    setTransformMode({ skillId, actionType, cardFilter: filter, wrapperName });
  }, [perspectiveHand]);

  return {
    transformMode,
    setTransformMode,
    skippedBroadcast,
    setSkippedBroadcast,
    send,
    pendingRespondInfo,
    handleRespond,
    handlePlayCard,
    handleTransformPlay,
    enterTransformMode,
    clearSkippedBroadcast: () => setSkippedBroadcast(new Set()),
  };
}
