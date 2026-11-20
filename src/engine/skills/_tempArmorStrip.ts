// skills/_tempArmorStrip.ts — 「无视防具」效果的共享实现(青釭剑模式)。
//
// 使用方(青釭剑/界陷阵)在【杀】指定目标后,临时卸载目标装备栏防具对应的技能实例
// (移除技能——只摘 hook,不触发 卸下:装备仍在装备区,白银狮子「失去装备回血」
// 监听 卸下 atom,不受影响);杀结算完毕后重新实例化恢复(添加技能)。
// 防具技能 id 动态查找:目标 equipment['防具'] → cardMap → card.name 即防具技能 id,
// 无需硬编码防具列表。
//
// 恢复必须同时挂 两个 after-hook:
//   - 杀命中 → 造成伤害后;
//   - 杀被闪抵消 → 被抵消(该路径不造成伤害,造成伤害后 不触发)。
// 两条路径互斥,合起来覆盖杀的全部退出路径——只挂 造成伤害后 时,dodge 路径的
// 防具永久泄漏(后续对该目标的杀失去防具保护)。
//
// 记录形状:WeakMap 外挂在 GameState 上(state-bound,随 state 自动隔离/GC,无模块级
// 泄漏),key = 效果来源(技能 owner)座次(多玩家同时持有效果时互不干扰),
// value = 被卸载的 {target, skillId} 数组(多目标杀逐目标累积,同目标去重)。
import type { GameState } from '../types';

import { registerAfterHook } from '../core/skill';
import { unloadSkillInstance, instantiateSkill } from './lifecycle';

/** 被临时卸载的防具技能记录条目。 */
interface StrippedArmor {
  target: number;
  skillId: string;
}

const strippedArmorsByState = new WeakMap<GameState, Map<number, Array<StrippedArmor>>>();

function getStrippedMap(state: GameState): Map<number, Array<StrippedArmor>> {
  let m = strippedArmorsByState.get(state);
  if (!m) {
    m = new Map();
    strippedArmorsByState.set(state, m);
  }
  return m;
}

/** 临时卸载 target 的防具技能实例并记录到 ownerId 名下,供
 *  registerArmorRestoreHooks 恢复。target 无防具/防具技能未加载/该目标已记录
 *  (上次杀的结算被跳过,记录残留)→ 不动作。 */
export function stripTargetArmor(state: GameState, ownerId: number, target: number): void {
  const targetPlayer = state.players[target];
  if (!targetPlayer) return;
  const armorId = targetPlayer.equipment?.['防具'];
  if (!armorId) return;
  const armorCard = state.cardMap[armorId];
  if (!armorCard) return;
  const armorSkillId = armorCard.name;
  if (!armorSkillId || !targetPlayer.skills.includes(armorSkillId)) return;
  const entries = getStrippedMap(state).get(ownerId) ?? [];
  if (entries.some((e) => e.target === target)) return;
  unloadSkillInstance(state, armorSkillId, target);
  entries.push({ target, skillId: armorSkillId });
  getStrippedMap(state).set(ownerId, entries);
}

/** 恢复被临时卸载的防具技能实例:重新实例化 ownerId 记录中 target 匹配的条目
 *  (target 缺省 = 全部)并从记录移除;无匹配记录则不动作。 */
async function restoreStrippedArmors(
  state: GameState,
  ownerId: number,
  target?: number,
): Promise<void> {
  const entries = getStrippedMap(state).get(ownerId);
  if (!entries || entries.length === 0) return;
  const matching = target === undefined ? entries : entries.filter((e) => e.target === target);
  if (matching.length === 0) return;
  for (const { target: t, skillId } of matching) {
    await instantiateSkill(state, skillId, t);
  }
  const rest = entries.filter((e) => !matching.includes(e));
  if (rest.length === 0) getStrippedMap(state).delete(ownerId);
  else getStrippedMap(state).set(ownerId, rest);
}

/** 恢复时机的目标过滤:返回本次应恢复的目标座次;undefined = 本次不恢复。
 *  缺省(不传)恢复全部记录(青釭剑)。界陷阵 传 winTarget 过滤——仅当
 *  atom.target === winTarget 时恢复该目标的防具(其他目标的伤害/抵消不消费记录)。 */
export type ArmorRestoreTargetFilter = (
  state: GameState,
  atom: { source: number; target: number },
) => number | undefined;

/** 注册「造成伤害后 + 被抵消」双恢复 after-hook(两时机互斥覆盖杀全部退出路径,
 *  见文件头)。触发守卫:atom.source === ownerId。restoreTarget 缺省恢复该 owner
 *  记录的全部被卸载防具;传入时仅恢复回调返回的目标。 */
export function registerArmorRestoreHooks(
  state: GameState,
  ownerId: number,
  skillId: string,
  restoreTarget?: ArmorRestoreTargetFilter,
): void {
  for (const atomType of ['造成伤害后', '被抵消'] as const) {
    registerAfterHook(state, skillId, ownerId, atomType, async (ctx) => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      const target = restoreTarget?.(ctx.state, atom);
      if (restoreTarget && target === undefined) return;
      await restoreStrippedArmors(ctx.state, ownerId, target);
    });
  }
}
