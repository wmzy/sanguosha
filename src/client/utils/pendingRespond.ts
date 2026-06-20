// src/client/utils/pendingRespond.ts
// Pending → respond 信息推导(纯函数)。
// 从 GameView.tsx 抽出:给定当前 pending + 已注册的技能 actions,
// 推导出「该回应哪个 skillId / 可回应的牌满足什么 cardFilter」。
//
// 设计:不依赖 React state 时序。
//   cardFilter 优先取 skillActionRegistry 里保留的函数引用(不走 WS JSON 序列化);
//   registry 异步加载窗口期取不到时,从 atom 类型本地重建兜底。

import type { Card, PendingView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import { findActionAcrossOwners } from '../skillActionRegistry';

/** 从 SkillActionDef 的 prompt 提取 cardFilter 函数(不走 JSON 序列化,函数引用保留) */
export function extractCardFilterFromAction(action: SkillActionDef): ((c: Card) => boolean) | undefined {
  const p = action.prompt;
  if ((p.type === 'useCard' || p.type === 'useCardAndTarget') && p.cardFilter?.filter) {
    return p.cardFilter.filter;
  }
  return undefined;
}

/**
 * 从 atom 类型本地构造 cardFilter 函数(不依赖 registry)。
 * 当前所有 respond 提示的 filter 都是 `c => c.name === '<cardName>'`:
 *   询问X → c.name==='X';请求回应 R/Y → c.name===R;__弃牌 → ()=>true。
 */
export function deriveCardFilterFromAtom(atomType: string, reqType: string): ((c: Card) => boolean) | undefined {
  // 询问X (X∈{闪,杀,...}):X = atomType.slice(2)
  if (atomType.startsWith('询问')) {
    const cardName = atomType.slice(2);
    if (!cardName) return undefined;
    return (c) => c.name === cardName;
  }
  // 请求回应 / 并行回应:
  //   'R/Y' → R 是 cardName;'R' → R 是 cardName;'__弃牌' → ()=>true
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

/**
 * 从 skillActionRegistry(已注册的所有玩家 actions)中查找某 skillId 的 respond action。
 * 优先当前 perspective 玩家(快路径),退路跨所有 ownerId 扫描(单例,不依赖 React state 时序)。
 */
export function findRespondAction(skillId: string, skillActions: SkillActionDef[]): SkillActionDef | undefined {
  const own = skillActions.find(a => a.skillId === skillId && a.actionType === 'respond');
  if (own) return own;
  return findActionAcrossOwners(skillId, 'respond');
}

export interface PendingRespondInfo {
  skillId: string;
  cardFilter?: (c: Card) => boolean;
}

/**
 * 推导当前 pending 的 respond 信息。
 * @param pending       当前 view.pending(可能为 null)
 * @param skillActions  当前 perspective 玩家的已注册技能 actions
 * @returns skillId + cardFilter;pending 为 null 或无法推导时返回 null
 */
export function resolvePendingRespond(
  pending: PendingView | null,
  skillActions: SkillActionDef[],
): PendingRespondInfo | null {
  if (!pending) return null;
  const atom = pending.atom as Record<string, unknown>;
  const atomType = pending.atom?.type ?? '';
  const reqType = typeof atom['requestType'] === 'string' ? (atom['requestType'] as string) : '';

  // 通用推导 skillId
  let skillId: string | null = null;
  if (atomType.startsWith('询问')) {
    skillId = atomType.slice(2); // 询问闪→闪
  } else if (reqType === '__弃牌') {
    skillId = '系统规则';
  } else if (atomType === '请求回应' || atomType === '并行回应') {
    if (!reqType) return null;
    skillId = reqType.includes('/') ? reqType.slice(0, reqType.indexOf('/')) : (reqType || null);
  }
  if (!skillId) return null;

  // 1. 优先:从 registry 取 cardFilter(函数引用保留)
  const action = findRespondAction(skillId, skillActions);
  const registryFilter = action ? extractCardFilterFromAction(action) : undefined;
  // 2. 兜底:从 atom 类型本地重建
  const localFilter = deriveCardFilterFromAtom(atomType, reqType);
  const cardFilter = registryFilter ?? localFilter;

  return { skillId, cardFilter };
}
