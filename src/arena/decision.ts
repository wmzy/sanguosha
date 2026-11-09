import type { ClientMessage } from '../engine/types';
import type { ArenaDecision, ArenaObservation, ArenaMenuAction } from './types';

export function completeAction(action: ArenaMenuAction): ClientMessage {
  const message = structuredClone(action.message);
  const params = message.params;
  if (action.selection?.mode !== 'allocate' && !Array.isArray(params.allocation) &&
    action.validTargets.length && params.target === undefined &&
    (params.targets === undefined || (Array.isArray(params.targets) && params.targets.length < (action.targetSelection?.min ?? action.minTarget ?? 1)))) {
    const selection = action.targetSelection;
    const targets = selection?.slots
      ? selection.slots.map((slot, index) => selection.slots![index + 1]?.after[index] ?? slot.candidates[0])
      : [...new Set([...(selection?.required ?? []), ...action.validTargets])].slice(0, selection?.min ?? action.minTarget ?? 1);
    params.targets = targets;
    if (targets.length === 1) params.target = targets[0];
  }
  return message;
}

export function resolveDecision(observation: ArenaObservation, decision: ArenaDecision): ClientMessage {
  if (decision.decisionId && decision.decisionId !== observation.decisionId) throw new Error('决策窗口已变化，请重新观察');
  const selected = observation.actions.find((a) => a.actionId === decision.actionId);
  if (!selected) throw new Error(`不存在的 actionId: ${decision.actionId}`);
  const message = completeAction(selected);
  if (decision.params) message.params = { ...message.params, ...decision.params };
  if (decision.params?.targets !== undefined) {
    const targets = decision.params.targets;
    if (Array.isArray(targets)) {
      if (decision.params.target !== undefined && decision.params.target !== targets[0]) throw new Error('target 与 targets 不一致');
      if (targets.length) message.params.target = targets[0];
      else delete message.params.target;
    }
  } else if (typeof decision.params?.target === 'number') message.params.targets = [decision.params.target];
  const distribute = selected.selection;
  if (distribute?.mode === 'allocate') {
    const allocations = message.params.allocation;
    if (!Array.isArray(allocations)) throw new Error('分配格式不合法');
    let total = 0;
    const usedCards = new Set<string>();
    for (const entry of allocations as Array<{ target?: unknown; cardIds?: unknown }>) {
      const target = entry?.target;
      const cardIds = entry?.cardIds;
      if (typeof target !== 'number' || !distribute.targets?.includes(target)) throw new Error('分配目标不合法');
      if (!Array.isArray(cardIds) || cardIds.length < (distribute.minPerTarget ?? 1) || cardIds.length > (distribute.maxPerTarget ?? 99))
        throw new Error('单个目标分配数量不合法');
      for (const cardId of cardIds) {
        if (typeof cardId !== 'string' || !distribute.cardIds.includes(cardId) || usedCards.has(cardId))
          throw new Error('分配牌不合法');
        usedCards.add(cardId);
        total++;
      }
    }
    if (total < distribute.minTotal || total > distribute.maxTotal) throw new Error('分配总数不合法');
    return message;
  }
  if (distribute?.mode === 'select') {
    const cardIds = message.params.cardIds;
    if (!Array.isArray(cardIds) || cardIds.length < distribute.minTotal || cardIds.length > distribute.maxTotal ||
      new Set(cardIds).size !== cardIds.length || cardIds.some((id) => typeof id !== 'string' || !distribute.cardIds.includes(id)))
      throw new Error('选牌不合法');
  }
  const targets = Array.isArray(message.params.targets)
    ? message.params.targets as number[]
    : typeof message.params.target === 'number' ? [message.params.target] : [];
  const selection = selected.targetSelection;
  if (selection) {
    if (selection.extraTarget !== undefined && targets.length > (selection.baseMax ?? selection.max) &&
      !targets.includes(selection.extraTarget)) throw new Error('额外目标必须为技能指定角色');
    if (targets.length < selection.min || targets.length > selection.max || new Set(targets).size !== targets.length)
      throw new Error('目标数量不合法');
    if (selection.required.some((target) => !targets.includes(target))) throw new Error('缺少必选目标');
    for (const [index, target] of targets.entries()) {
      const slot = selection.slots?.[index];
      if (slot?.after.some((v, i) => targets[i] !== v)) throw new Error('有序目标前缀已变化，请使用候选消息中的目标组合');
      if (!(slot?.candidates ?? selection.candidates).includes(target)) throw new Error('目标不在候选范围');
    }
  } else if (selected.validTargets.length && targets.some((target) => !selected.validTargets.includes(target))) {
    throw new Error('目标不在候选范围');
  }
  if (!selection && selected.validTargets.length &&
    (targets.length < (selected.minTarget ?? 1) || targets.length > (selected.maxTarget ?? 1)))
    throw new Error('目标数量不合法');
  // The engine remains authoritative for skill-specific card counts and arrangement rules.
  return message;
}
