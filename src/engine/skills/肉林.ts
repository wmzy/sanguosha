// 肉林(董卓·锁定技):你对女性角色/女性角色对你使用【杀】时,目标需连续出两张闪才能抵消。
//
// 实现方式(镜像无双):辅助函数 enforceRoulinDodge 嵌入「杀」的 execute。
// 原因同无双:等待型 atom(询问闪)被 before-hook cancel(如八卦阵判红放虚拟闪)后
// after-hook 不触发,无法用 hook 拦截追加第二轮询问。故在 execute 内 applyAtom(询问闪)
// 返回后,由杀.execute 主动调用 enforceRoulinDodge 检查肉林条件并追加第二次询问。
//
// 触发条件(任一):
//   - 肉林拥有者(董卓)作为杀的 source,且 target 为女性 → target 需双闪
//   - 肉林拥有者(董卓)作为杀的 target,且 source 为女性 → target(董卓)需双闪
import type { GameState, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { getGender } from '../character-meta';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '肉林',
    description: '锁定技:你对女性角色/女性角色对你使用【杀】时,目标需连续出两张闪才能抵消',
    isLocked: true,
  };
}

/** 肉林是否适用于此 source→target 的杀结算 */
function roulinApplies(state: GameState, source: number, target: number): boolean {
  const src = state.players[source];
  const tgt = state.players[target];
  if (!src || !tgt) return false;
  const srcRoulin = src.skills.includes('肉林');
  const tgtRoulin = tgt.skills.includes('肉林');
  const tgtFemale = getGender(tgt.character) === '女';
  const srcFemale = getGender(src.character) === '女';
  // 董卓(肉林)对女性使用杀,或女性对董卓(肉林)使用杀
  return (srcRoulin && tgtFemale) || (tgtRoulin && srcFemale);
}

/**
 * 肉林·杀:若肉林条件成立,消耗处理区已有的全部闪牌(移入弃牌堆),
 * 再追加一次 applyAtom(询问闪)。
 *
 * 在 杀.execute 的 applyAtom(询问闪) 之后调用(紧随 enforceDualDodge)。
 * 肉林条件不成立或处理区无闪则 no-op。
 *
 * 注意:与无双互斥——无双检查 source 拥有无双,肉林检查 source/target 拥有肉林+异性。
 * 一个玩家不会同时拥有无双和肉林,且性别条件独立,故两者叠加时各自独立判断,
 * 第二次调用(若都触发)会因处理区无闪而 no-op,安全。
 */
export async function enforceRoulinDodge(
  state: GameState,
  source: number,
  target: number,
): Promise<void> {
  if (!roulinApplies(state, source, target)) return;
  const firstDodges = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
  if (firstDodges.length === 0) return;
  for (const id of firstDodges) {
    await applyAtom(state, {
      type: '移动牌',
      cardId: id,
      from: { zone: '处理区' },
      to: { zone: '弃牌堆' },
    });
  }
  await applyAtom(state, { type: '询问闪', target, source });
}

export function onInit(_skill: Skill, _state: GameState): () => void {
  // 肉林逻辑通过 enforceRoulinDodge 嵌入 杀.execute,无独立 hook/action。
  // 仍需 createSkill 实例化,使 player.skills.includes('肉林') 判定成立。
  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
