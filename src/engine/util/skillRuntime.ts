// src/engine/util/skillRuntime.ts — 技能运行期共享小助手。
// 收敛 skills/ 下逐字复制的四类样板(SkillMicro + SkillRespond 共享本文件,改导出名前先协调):
//   1) runVirtualSlash:7 处"视为出杀"结算(界乱武/界仁德/界惴恐/界明策/界求援/界神速/神速);
//   2) requireRequestType:respond validate 的「读 pending slot → 断言 请求回应 → 比对 requestType」三连;
//   3) currentRequestType:读座次当前 pending 的 requestType(14 处局部副本,3 种 as 断言
//      变体统一为最严格一种:直接 as { requestType?: string },编译器校验可比性);
//   4) slotOf:装备牌 subtype → 装备栏位(与 装备 atom 的 inferSlot 一致,7+2 处副本)。
// 命名:函数/类型英文;业务字面量(牌名 '杀'/atom 类型 '请求回应'/错误文案)保持中文。
import type { EquipSlot, GameState } from '../types';
import { runUseFlow, chargeOnSettle } from '../skills/cards/use-card';

// ────────────────────────── 虚拟杀结算 ──────────────────────────

export interface RunVirtualSlashOptions {
  /** 虚拟杀 cardId 前缀(技能名):最终 id 为 `${prefix}:杀:${source}:${target}:${state.seq}` */
  prefix: string;
  /** 是否计入出杀次数(挂 chargeOnSettle 计费,由 杀.onSettle→incSlashUsed 累加)。默认不计。 */
  charge?: boolean;
}

/**
 * 执行一次"视为出杀"的完整结算(无实体牌,runUseFlow virtual 模式):
 * 指定目标→成为目标→检测有效性→询问闪→伤害/抵消,时机 atom 序列与实体杀一致。
 * 虚拟杀无实体,但结算流程中 atoms/toViewEvents 需要 cardMap[id] 存在,故先写入、结算后删除(不入弃牌堆)。
 * 不消耗手牌、无距离限制(调用方已选定目标,不再校验距离)。
 *
 * @returns 是否对 target 造成了伤害(结算前后体力差比对;防具/反馈/奸雄等可能改伤)。
 *          不关心该结果的调用方可直接忽略返回值。
 */
export async function runVirtualSlash(
  state: GameState,
  source: number,
  target: number,
  opts: RunVirtualSlashOptions,
): Promise<boolean> {
  if (!state.players[target]?.alive) return false;
  const targetHealthBefore = state.players[target].health;
  const cardId = `${opts.prefix}:杀:${source}:${target}:${state.seq}`;
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };
  await runUseFlow(state, source, cardId, [target], '杀', {
    virtual: true,
    onSettle: opts.charge ? chargeOnSettle(state, source, cardId) : undefined,
  });
  delete state.cardMap[cardId];
  return state.players[target].health < targetHealthBefore;
}

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

// ────────────────────────── pending requestType 读取 ──────────────────────────

/** 当前 pending 的 requestType(类型安全读取)。座次无 pending 时返回 undefined。 */
export function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as { requestType?: string }).requestType;
}

// ────────────────────────── 装备牌栏位推断 ──────────────────────────

/** 装备牌 subtype → 装备栏位(与 装备 atom 的 inferSlot 一致) */
export function slotOf(card: { subtype?: string } | undefined): EquipSlot | null {
  switch (card?.subtype) {
    case '武器':
      return '武器';
    case '防具':
      return '防具';
    case '进攻马':
      return '进攻马';
    case '防御马':
      return '防御马';
    case '宝物':
      return '宝物';
    default:
      return null;
  }
}
