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

/** requestType 首段('R/...' | 'R_...' → 'R';'R' → 'R')。
 *  '/'(杀/respondKill、桃/求桃)与 '_'(过河拆桥_选牌)都是「技能/牌名 + 修饰」分隔符,
 *  取首段即得请求的牌名或发起技能 id。原散落各处的 `reqType.search(/[/_]/)` 切分统一走此。 */
export function requestTypeFirstSegment(reqType: string): string {
  const sep = reqType.search(/[/_]/);
  return sep >= 0 ? reqType.slice(0, sep) : reqType;
}

/** pending 请求的牌名(转化技回应方向的判据;浏览器 usePlayInteraction 与无头
 *  availableActions 同一判据,原先两处逐字重复):
 *  - 询问X → X(询问杀/询问闪)
 *  - 请求回应 'R/...' → R(杀/respondKill、无懈可击、闪、桃/求桃…)
 *  pending 不属于该座次(target !== seatIndex 且 target >= 0)或非这两类 atom → null。
 *  广播型(target<0,如无懈可击)对所有存活座次开放,返回请求牌名。 */
export function getPendingRequestedName(
  pending: PendingView | null,
  seatIndex: number,
): string | null {
  if (!pending) return null;
  if (pending.target !== seatIndex && pending.target >= 0) return null;
  const atomType = pending.atom?.type ?? '';
  if (atomType.startsWith('询问')) return atomType.slice(2) || null;
  if (atomType === '请求回应') {
    const reqType = getPendingRequestType(pending);
    if (!reqType) return null;
    return requestTypeFirstSegment(reqType) || null;
  }
  return null;
}

/** 构造广播型 pending 的去重 key("<atomType>:<requestType>:t=<target>:c=<cancelTarget>")。
 *  用于 markBroadcastSkipped / skippedBroadcast 判重,避免同一 pending 重复弹窗。
 *
 *  target/cancelTarget 必须纳入 key:铁索连环等多目标询问会广播多次「无懈可击」,
 *  两次的 atomType='请求回应' + requestType='无懈可击' 完全相同,只有 cancelTarget 不同。
 *  若不区分,玩家对目标1点「不回应」会把该 key 加入 skippedBroadcast,
 *  目标2的广播到达时 key 不变 → 重置 effect 不触发 → 目标2被误判为「已跳过」而隐藏。
 *  对同一目标的 close-reopen 循环(闪的连续询问 / 同一目标的反复无懈),cancelTarget 不变
 *  → key 不变 → skippedBroadcast 不重置,保持「玩家对该目标说过不回应就不再弹窗」的去重语义。 */
export function getBroadcastKey(pending: PendingView): string {
  const atomType = pending.atom?.type ?? '';
  const reqType = getPendingRequestType(pending);
  const atom = pending.atom as Record<string, unknown> | null;
  const target = atom?.['target'];
  const cancelTarget = atom?.['cancelTarget'];
  const targetStr = typeof target === 'number' ? String(target) : '';
  const cancelStr = typeof cancelTarget === 'number' ? String(cancelTarget) : '';
  return `${atomType}:${reqType}:t=${targetStr}:c=${cancelStr}`;
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
  // 请求回应:
  //   'R/Y' → R 是 cardName;'R' → R 是 cardName;'__弃牌' → ()=>true
  if (atomType === '请求回应') {
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
  } else if (atomType === '请求回应') {
    if (!reqType) return null;
    // 'R/Y' → R 是 skillId;'R' → R 是 skillId;'R_盲选' → R 是 skillId
    skillId = requestTypeFirstSegment(reqType) || null;
  }
  if (!skillId) return null;

  // 求桃特判:濒死求桃时,可救援的牌分两类——
  //   ① 字面桃(任何人可用)/字面酒(仅自救):CardEffect 型卡牌(桃.ts/酒.ts),respond 定义在
  //      CardEffect.respond 字段,无前端 onMount → 不注册到 skillActionRegistry,respond skillId
  //      为卡名('桃'/'酒')。引擎投影层用 canRescueWith 把它们注入 cardFilter.candidates
  //      (含「酒仅自救」语义)。
  //   ② 转化型救援技(急救红牌当桃/界醇醪移醇当酒):SkillDef onMount defineAction respond,
  //      respondFor='桃/求桃',在 registry 中,filter 在 prompt.cardFilter.filter。
  // cardFilter = candidates(权威,含酒仅自救) ∪ 转化技 filter 的并集;
  // rescueSkillForCard 按牌名优先路由字面桃/酒到同名 CardEffect,否则落到匹配的转化技。
  //
  // 修复 Bug2/Bug8:旧实现 rescueActions 只筛 registry 转化技,漏掉字面桃/酒(CardEffect 无
  // 前端注册)——非空时 cardFilter/rescueSkillForCard 仅含转化技(桃误路由到急救、酒被漏);
  // 为空时走兜底 skillId='桃' 但无 rescueSkillForCard → 点酒退回 '桃' → 桃 validate 拒绝酒。
  const PEACH_RESCUE = '桃/求桃';
  if (reqType === PEACH_RESCUE) {
    const transformRescue = skillActions.filter((a) => a.respondFor === PEACH_RESCUE);
    const candidates = readCardFilterCandidates(pending);
    const candSet = candidates ? new Set(candidates) : null;
    const literalMatch: (c: Card) => boolean = candSet
      ? (c) => candSet.has(c.id)
      : (c) => c.name === '桃' || c.name === '酒';
    const transformMatch = (c: Card): boolean =>
      transformRescue.some((a) => extractCardFilterFromAction(a)?.(c));
    return {
      skillId,
      cardFilter: (c: Card) => literalMatch(c) || transformMatch(c),
      rescueSkillForCard: (c: Card) => {
        // 字面桃/酒优先路由到同名 CardEffect(桃是红牌也满足急救 filter,但应走 桃.respond)
        if (c.name === '桃' || c.name === '酒') return c.name;
        return transformRescue.find((a) => extractCardFilterFromAction(a)?.(c))?.skillId;
      },
    };
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
