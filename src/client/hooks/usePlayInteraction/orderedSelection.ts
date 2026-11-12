// src/client/hooks/usePlayInteraction/orderedSelection.ts
// 有序多选共享工具(从 usePlayInteraction.ts 拆出,纯结构搬运):
// 弃牌阶段多选、多卡转化多选、distribute 全选/反选 共用同一套有序 + FIFO 语义。

/**
 * 有序选择 + FIFO 淘汰:点击一张牌 toggle 其选中状态。
 * - 已选 → 移除。
 * - 未选且未达上限(max>0)→ 追加到末尾,保持插入顺序。
 * - 未选且已达 max → 淘汰"最早选中的"(数组首位),再把新牌追加到末尾
 *   (而不是禁止选择),实现"选满后继续选自动取消最早那张"。
 * max 为 undefined/<=0 视为无上限,直接追加。
 * 用于弃牌阶段多选(按 discardMax)与多卡转化(按 transformMode.maxCards)。
 */
export function toggleOrderedFifo(selected: string[], id: string, max?: number): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (max === undefined || max <= 0) return [...selected, id];
  if (selected.length < max) return [...selected, id];
  return [...selected.slice(1), id];
}

/** 全选:候选按序选中,超 max 时取前 max(自然阅读顺序,左→右)。max<=0/undefined=无上限。 */
export function selectAllOrdered(candidates: string[], max?: number): string[] {
  if (max === undefined || max <= 0) return [...candidates];
  return candidates.slice(0, max);
}

/**
 * 反选:取候选中当前未选的;结果超 max 时按 FIFO 保留较晚选的(取尾部)。
 * max<=0/undefined=无上限。
 */
export function invertOrdered(candidates: string[], selected: string[], max?: number): string[] {
  const sel = new Set(selected);
  const complement = candidates.filter((c) => !sel.has(c));
  if (max === undefined || max <= 0) return complement;
  return complement.length > max ? complement.slice(-max) : complement;
}
