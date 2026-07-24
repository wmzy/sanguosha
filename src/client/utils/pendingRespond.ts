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

/** 安全读取 pending.atom.requestType(消除散落各处的 `as { requestType?: string }` 断言)。
 *  atom 可能为 null 或不含 requestType 字段,统一在此处理。 */
export function getPendingRequestType(pending: PendingView): string {
  const atom = pending.atom as Record<string, unknown> | null;
  const v = atom?.['requestType'];
  return typeof v === 'string' ? v : '';
}

/** 构造广播型 pending 的去重 key("<atomType>:<requestType>")。
 *  用于 markBroadcastSkipped / skippedBroadcast 判重,避免同一 pending 重复弹窗。 */
export function getBroadcastKey(pending: PendingView): string {
  const atomType = pending.atom?.type ?? '';
  return `${atomType}:${getPendingRequestType(pending)}`;
}

/** 从 pending 读取引擎投影层下发的 cardFilter.candidates(合法手牌 id 列表)。
 *  pending.prompt 与 pending.atom.prompt 两处均可能携带(applyView 同时写入),取非空者。 */
function readCardFilterCandidates(pending: PendingView): string[] | undefined {
  const prompts = [
    pending.prompt as { cardFilter?: { candidates?: string[] } } | undefined,
    (pending.atom as { prompt?: { cardFilter?: { candidates?: string[] } } } | undefined)?.prompt,
  ];
  for (const p of prompts) {
    const c = p?.cardFilter?.candidates;
    if (Array.isArray(c)) return c;
  }
  return undefined;
}

/** 从 SkillActionDef 的 prompt 提取 cardFilter 函数(不走 JSON 序列化,函数引用保留) */
export function extractCardFilterFromAction(
  action: SkillActionDef,
): ((c: Card) => boolean) | undefined {
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
export function deriveCardFilterFromAtom(
  atomType: string,
  reqType: string,
): ((c: Card) => boolean) | undefined {
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
    // 求桃兜底(registry 未加载窗口期):桃或酒均可救援
    if (reqType === '桃/求桃') return (c) => c.name === '桃' || c.name === '酒';
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
export function findRespondAction(
  skillId: string,
  skillActions: SkillActionDef[],
): SkillActionDef | undefined {
  const own = skillActions.find((a) => a.skillId === skillId && a.actionType === 'respond');
  if (own) return own;
  return findActionAcrossOwners(skillId, 'respond');
}

export interface PendingRespondInfo {
  skillId: string;
  cardFilter?: (c: Card) => boolean;
  /** 求桃专用:按救援牌(桃/酒/急救红牌)找到对应的救援 skillId。
   *  非 null 时 handleRespond 优先用它路由,而非默认 skillId('桃')。 */
  rescueSkillForCard?: (c: Card) => string | undefined;
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
  const atomType = pending.atom?.type ?? '';
  const reqType = getPendingRequestType(pending);

  // 通用推导 skillId
  let skillId: string | null = null;
  if (atomType.startsWith('询问')) {
    skillId = atomType.slice(2); // 询问闪→闪
  } else if (reqType === '__弃牌') {
    skillId = '系统规则';
  } else if (atomType === '请求回应' || atomType === '并行回应') {
    if (!reqType) return null;
    // 'R/Y' → R 是 skillId;'R' → R 是 skillId;'R_盲选' → R 是 skillId
    const sepIdx = reqType.search(/[/_]/);
    skillId = sepIdx >= 0 ? reqType.slice(0, sepIdx) : reqType || null;
  }
  if (!skillId) return null;

  // 求桃特判:合并所有 respondFor='桃/求桃' 的救援 action(桃/酒/急救),
  // cardFilter 取并集(手牌区高亮所有可救援牌),rescueSkillForCard 按 cardId 路由。
  // registry 异步加载窗口期(rescueActions 为空)走下方通用兜底。
  const PEACH_RESCUE = '桃/求桃';
  if (reqType === PEACH_RESCUE) {
    const rescueActions = skillActions.filter((a) => a.respondFor === PEACH_RESCUE);
    if (rescueActions.length > 0) {
      return {
        skillId,
        cardFilter: (c: Card) => rescueActions.some((a) => extractCardFilterFromAction(a)?.(c)),
        rescueSkillForCard: (c: Card) =>
          rescueActions.find((a) => extractCardFilterFromAction(a)?.(c))?.skillId,
      };
    }
  }

  // 引擎投影层下发的可序列化 candidates(权威):cardFilter.filter 是函数,跨进程丢失,
  // 投影层已跑 filter 算出合法手牌 id 列表。优先用它重建成员判断 filter,覆盖下方
  // registry/derive 猜测——解决技能代价弃牌(界放权/放权/据守 等 requestType 前缀为技能名)
  // 时 derive 误推 c.name===技能名 匹配 0 张、玩家无法弃牌的问题。
  const candidates = readCardFilterCandidates(pending);
  if (candidates) {
    const set = new Set(candidates);
    return { skillId, cardFilter: (c: Card) => set.has(c.id) };
  }

  // 1. 优先:从 registry 取 cardFilter(函数引用保留)
  const action = findRespondAction(skillId, skillActions);
  const registryFilter = action ? extractCardFilterFromAction(action) : undefined;
  // 2. 兜底:从 atom 类型本地重建
  const localFilter = deriveCardFilterFromAtom(atomType, reqType);
  const cardFilter = registryFilter ?? localFilter;

  return { skillId, cardFilter };
}
