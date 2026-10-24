import type { Card, GameView, TargetFilter } from '../types';
import { viewSlashTargetMax } from './action-active';

/** 可跨 JSON 的选择契约。slots[i] 的候选只适用于 after 前缀，不是独立笛卡尔积。 */
export interface TargetSelection {
  min: number;
  max: number;
  required: number[];
  candidates: number[];
  slots?: Array<{ label: string; after: number[]; candidates: number[] }>;
}

type TargetCard = Pick<Card, 'name'> & Partial<Pick<Card, 'id' | 'damageType'>> & {
  /** 这张牌是否就是「正在使用的牌」。技能代价牌(离间 弃一张牌、强袭 弃武器)为 false:
   *  只有真在用的【杀】才按杀的动态目标上限解释。缺省 = 按牌名判断。 */
  countsAsSlash?: boolean;
};

export function targetSelectionBounds(
  view: GameView,
  ownerId: number,
  filter: TargetFilter,
  card?: TargetCard,
): { min: number; max: number } {
  if (filter.slots?.length) return { min: filter.slots.length, max: filter.slots.length };
  const cardMax = card?.id ? filter.maxByCard?.[card.id] : undefined;
  // countsAsSlash 约定:true(缺省)= 这张牌就是正在使用的牌,false = 技能代价牌
  // (离间 弃一张牌、强袭 弃武器)。代价牌不能按杀的动态上限解释,否则
  // 固定目标数技能(离间 min=max=2)的上限会被算成 1,客户端提交不出合法目标数。
  const usingCard = card?.countsAsSlash ?? true;
  const slashName = usingCard && card?.name === '杀';
  return {
    min: filter.min,
    max: cardMax ?? (slashName ? viewSlashTargetMax(view, ownerId, card) : filter.max),
  };
}

/** 唯一的候选解释器。调用方传入已选前缀，永远不读取权威状态或对手暗牌。 */
export function targetCandidates(
  view: GameView,
  ownerId: number,
  filter: TargetFilter,
  selected: readonly number[] = [],
  card?: TargetCard,
): number[] {
  const slot = filter.slots?.[selected.length];
  if (filter.slots?.length && !slot) return [];
  const candidates = slot?.candidates ??
    (card?.id ? filter.candidatesByCard?.[card.id] : undefined) ?? filter.candidates;
  return view.players.filter((player) => {
    const target = player.index;
    if (!player.alive || selected.includes(target)) return false;
    if (slot) return !slot.filter || slot.filter(view, target, { selected: [...selected] });
    if (target === ownerId && !filter.allowSelf) return false;
    if (candidates) return candidates.includes(target);
    return !filter.filter || filter.filter(view, target);
  }).map((player) => player.index);
}

export function validateTargetSelection(
  view: GameView,
  ownerId: number,
  filter: TargetFilter,
  selected: readonly number[],
  card?: TargetCard,
): boolean {
  const { min, max } = targetSelectionBounds(view, ownerId, filter, card);
  if (selected.length < min || selected.length > max) return false;
  if (filter.required?.some((target) => !selected.includes(target))) return false;
  return selected.every((target, index) =>
    targetCandidates(view, ownerId, filter, selected.slice(0, index), card).includes(target));
}

/** 找一组最小合法选择，而非展开所有组合。ordered slots 仅按需深搜直到首个解。 */
export function resolveTargetSelection(
  view: GameView,
  ownerId: number,
  filter: TargetFilter,
  card?: TargetCard,
): { targets: number[] | null; contract: TargetSelection } {
  const { min, max } = targetSelectionBounds(view, ownerId, filter, card);
  const required = [...new Set(filter.required ?? [])];
  const candidates = targetCandidates(view, ownerId, filter, [], card);
  let targets: number[] | null = null;
  if (filter.slots?.length) {
    const search = (prefix: number[]): number[] | null => {
      if (prefix.length === max)
        return validateTargetSelection(view, ownerId, filter, prefix, card) ? prefix : null;
      for (const target of targetCandidates(view, ownerId, filter, prefix, card)) {
        const result = search([...prefix, target]);
        if (result) return result;
      }
      return null;
    };
    targets = search([]);
  } else if (required.every((target) => candidates.includes(target))) {
    const selected = [...required];
    for (const target of candidates) {
      if (selected.length >= min) break;
      if (!selected.includes(target)) selected.push(target);
    }
    if (validateTargetSelection(view, ownerId, filter, selected, card)) targets = selected;
  }
  const contract: TargetSelection = { min, max, required, candidates };
  if (filter.slots?.length && targets) {
    contract.slots = filter.slots.map((slot, index) => ({
      label: slot.label,
      after: targets.slice(0, index),
      candidates: targetCandidates(view, ownerId, filter, targets.slice(0, index), card),
    }));
  }
  return { targets, contract };
}

/** 通用点击语义：有序槽位回点前槽会截断后槽；集合选择允许取消/替换单目标。 */
export function toggleTargetSelection(
  view: GameView,
  ownerId: number,
  filter: TargetFilter,
  selected: readonly number[],
  target: number,
  card?: TargetCard,
): number[] {
  const existing = selected.indexOf(target);
  if (existing >= 0)
    return filter.slots?.length ? selected.slice(0, existing) : selected.filter((item) => item !== target);
  const { max } = targetSelectionBounds(view, ownerId, filter, card);
  const prefix = !filter.slots?.length && max === 1 ? [] : selected;
  if (prefix.length >= max || !targetCandidates(view, ownerId, filter, prefix, card).includes(target))
    return [...selected];
  return [...prefix, target];
}
