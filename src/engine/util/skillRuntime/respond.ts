// src/engine/util/skillRuntime/respond.ts — pending 询问与 respond 注册样板。
// (自 util/skillRuntime.ts 按内聚拆出;导出经桶文件 skillRuntime.ts re-export,调用方零改动。)
// 收敛 skills/ 下逐字复制的样板:
//   requireRequestType:respond validate 的「读 pending slot → 断言 请求回应 → 比对 requestType」三连;
//   registerConfirmRespond:confirm 型 respond 三件套;
//   askConfirm / askResponse:询问三段(delete 键残值 → applyAtom(请求回应) → 读键);
//   currentRequestType:读座次当前 pending 的 requestType;
//   hasNullifyWindow:无懈可击广播窗口扫描(看破/界看破/解围 转化 validate 共用);
//   registerRespondForAllSeats:respond 注册到全部座次的 for 循环样板(鞬出 骨架)。
// 命名:函数/类型英文;业务字面量(atom 类型 '请求回应'/错误文案)保持中文。
import type { ActionPrompt, GameState, Json } from '../../types';
import { registerAction } from '../../core/skill';
import { applyAtom } from '../../core/apply';

// ────────────────────────── respond validate 样板 ──────────────────────────

export interface RequireRequestTypeOptions {
  /** requestType 不在允许列表时的错误文案 */
  mismatchError: string;
  /** pending slot 缺失时的错误文案(默认 '当前不需要回应') */
  noSlotError?: string;
  /** slot 的 atom 类型不是 请求回应 时的错误文案(默认同 noSlotError) */
  wrongTypeError?: string;
}

export type RequestTypeCheck =
  | { error: string; requestType: null }
  | { error: null; requestType: string };

/**
 * respond validate 通用样板:读座次的 pending slot → 断言 atom 为 请求回应 → 比对 requestType。
 * 任一步不满足即返回对应错误文案;全部通过时返回匹配到的 requestType(供后续按类型分支校验参数)。
 *
 * 用法:
 * ```ts
 * const check = requireRequestType(state, ownerId, [CONFIRM_RT, ARRANGE_RT], {
 *   mismatchError: '当前不是恂恂询问',
 * });
 * if (check.error) return check.error;
 * const rt = check.requestType;
 * ```
 */
export function requireRequestType(
  state: GameState,
  seat: number,
  requestTypes: readonly string[],
  opts: RequireRequestTypeOptions,
): RequestTypeCheck {
  const atom = state.pendingSlots.get(seat)?.atom;
  const noSlotError = opts.noSlotError ?? '当前不需要回应';
  if (!atom) return { error: noSlotError, requestType: null };
  if (atom.type !== '请求回应') {
    return { error: opts.wrongTypeError ?? noSlotError, requestType: null };
  }
  if (!requestTypes.includes(atom.requestType)) {
    return { error: opts.mismatchError, requestType: null };
  }
  return { error: null, requestType: atom.requestType };
}

// ────────────────────────── confirm 型询问/respond 样板 ──────────────────────────

/** registerConfirmRespond 可选项。 */
export interface ConfirmRespondOptions {
  /** requestType 不匹配时的错误文案(默认 `当前不是${skillId}确认`) */
  mismatchError?: string;
}

/**
 * 注册 confirm 型 respond action(单一 confirm 询问的完整三件套):
 *   validate = requireRequestType(单 requestType);
 *   execute  = localVars[confirmedKey] = choice===true || confirmed===true
 * (choice/confirmed 是客户端两种键名形态,一并接受)。
 * 仅适用于「该 respond 只处理一个 confirm 询问」的形态;confirm 之外还分支
 * 选牌/选人/额外参数校验的 respond(反馈/寒冰剑/界利驭/界强识 模式)不适用,
 * 仍由各技能手写分支。返回 unloader(registerAction 原样透传)。
 */
export function registerConfirmRespond(
  state: GameState,
  skillId: string,
  ownerId: number,
  requestType: string,
  confirmedKey: string,
  opts: ConfirmRespondOptions = {},
): () => void {
  return registerAction(
    state,
    skillId,
    ownerId,
    'respond',
    (st, _params) =>
      requireRequestType(st, ownerId, [requestType], {
        mismatchError: opts.mismatchError ?? `当前不是${skillId}确认`,
      }).error,
    async (st, params) => {
      st.localVars[confirmedKey] = params.choice === true || params.confirmed === true;
    },
  );
}

/** askConfirm 可选项(title/文案/超时各技能现状不同,逐字透传,不得统一)。 */
export interface AskConfirmOptions {
  /** localVars 确认键:询问前 delete 清残值;回应后由 respond execute 写入。 */
  confirmedKey: string;
  /** prompt.title */
  title: string;
  /** prompt.description(可选) */
  description?: string;
  /** prompt.confirmLabel(可选) */
  confirmLabel?: string;
  /** prompt.cancelLabel(可选) */
  cancelLabel?: string;
  /** 超时默认选择。请求回应.onTimeout 仅对弃牌型询问写 localVars,confirm 型超时
   *  不写 → 确认键 undefined 时按本值兜底(undefined==default 模式,同 制霸/洛神)。 */
  defaultChoice?: boolean;
  /** 超时秒数(各技能不同:再起/反馈/寒冰剑/界利驭 10、克己/界强识 15、博图 20) */
  timeout?: number;
}

/**
 * confirm 型询问三段样板:delete 确认键残值 → applyAtom(请求回应,confirm prompt)
 * → 读确认键并归一为 boolean(超时未设键按 defaultChoice 兜底)。
 * 读后不删确认键:屯田 的「判定牌生效后」hook 在本函数返回后仍需读取;
 * 需要收尾清理的调用方(博图/界利驭/界强识)自行 delete。
 */
export async function askConfirm(
  state: GameState,
  requestType: string,
  target: number,
  opts: AskConfirmOptions,
): Promise<boolean> {
  delete state.localVars[opts.confirmedKey];
  await applyAtom(state, {
    type: '请求回应',
    requestType,
    target,
    prompt: {
      type: 'confirm',
      title: opts.title,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      ...(opts.confirmLabel !== undefined ? { confirmLabel: opts.confirmLabel } : {}),
      ...(opts.cancelLabel !== undefined ? { cancelLabel: opts.cancelLabel } : {}),
    },
    ...(opts.defaultChoice !== undefined ? { defaultChoice: opts.defaultChoice } : {}),
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
  });
  const answer = state.localVars[opts.confirmedKey];
  if (answer === undefined) return opts.defaultChoice === true;
  return answer === true;
}

// ────────────────────────── 请求回应通用三段式 ──────────────────────────

export interface AskResponseOptions {
  /** prompt(必填;type 由调用方决定:useCard/choosePlayer/chooseOption/…) */
  prompt: ActionPrompt;
  /** 超时秒数;缺省不注入 → 请求回应 atom 默认(30,无懈可击 10) */
  timeout?: number;
  /** 超时/跳过的缺省回应(透传 atom defaultChoice) */
  defaultChoice?: Json;
  /** localVars 结果键;缺省由 requestType 派生:`${requestType}/回应结果`。
   *  respond execute 写入的键必须与此一致才能读到。 */
  resultKey?: string;
}

/** 请求回应三段式:delete 结果键残值 → applyAtom({type:'请求回应',…})
 * → 读键 → delete 键(返回回应值,未回应为 undefined)。
 *  各技能 respond execute「写 localVars 键、编排函数读后即删」的公共骨架
 *  (界弓骑选目标、界荐言声明/选目标、放权弃牌/选额外目标等)。 */
export async function askResponse<T = Json | undefined>(
  state: GameState,
  requestType: string,
  target: number,
  opts: AskResponseOptions,
): Promise<T | undefined> {
  const key = opts.resultKey ?? `${requestType}/回应结果`;
  delete state.localVars[key];
  await applyAtom(state, {
    type: '请求回应',
    requestType,
    target,
    prompt: opts.prompt,
    ...(opts.defaultChoice !== undefined ? { defaultChoice: opts.defaultChoice } : {}),
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
  });
  const result = state.localVars[key] as T | undefined;
  delete state.localVars[key];
  return result;
}

// ────────────────────────── pending requestType 读取 ──────────────────────────

/** 当前 pending 的 requestType(类型安全读取)。座次无 pending 时返回 undefined。 */
export function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as { requestType?: string }).requestType;
}

// ────────────────────────── 无懈可击广播窗口 ──────────────────────────

/** 当前是否存在无懈可击广播窗口(玩家可回应):扫描 pendingSlots 找
 *  请求回应 + requestType='无懈可击',广播型(target<0)或精确指向本玩家。
 *  看破/界看破/解围 的转化 validate 与 activeWhen 共用此判据(自 看破.ts 上提)。 */
export function hasNullifyWindow(state: GameState, playerId: number): boolean {
  for (const slot of state.pendingSlots.values()) {
    const atom = slot.atom as { type?: string; requestType?: string; target?: number };
    if (atom.type !== '请求回应') continue;
    if (atom.requestType !== '无懈可击') continue;
    // 广播型(target<0)或精确指向本玩家
    if (typeof atom.target === 'number' && (atom.target < 0 || atom.target === playerId))
      return true;
  }
  return false;
}

// ────────────────────── respond 注册到全部座次的 for 循环样板 ──────────────────────

/**
 * 把技能的 respond action 注册到全部座次(每个座次一个 (skillId, seat, 'respond') 键,
 * validate/execute 收到座次号,自行读 pendingSlots.get(seat))。
 * 收敛 36 处 `for (const p of state.players) { const seatId = p.index;
 * unloaders.push(registerAction(state, skill.id, seatId, 'respond', …)) }` 样板
 * (参考现状 鞬出.ts:104-143;技能可被任意座次的玩家获得,注册须覆盖全部座次)。
 *
 * @returns 每座次的 unloader 列表(调用方 spread 进自己的 unloaders)。
 */
export function registerRespondForAllSeats(
  state: GameState,
  skillId: string,
  validate: (
    state: GameState,
    seat: number,
    params: Record<string, Json>,
  ) => string | null,
  execute: (
    state: GameState,
    seat: number,
    params: Record<string, Json>,
  ) => Promise<void>,
): Array<() => void> {
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seat = p.index;
    unloaders.push(
      registerAction(
        state,
        skillId,
        seat,
        'respond',
        (st, params) => validate(st, seat, params),
        (st, params) => execute(st, seat, params),
      ),
    );
  }
  return unloaders;
}
