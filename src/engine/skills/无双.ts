// 无双(吕布·锁定技):
//   1. 你使用【杀】指定一名角色为目标时,该角色需连续使用两张【闪】才能抵消
//   2. 与你进行【决斗】的角色每次需连续打出两张【杀】
//
// 实现方式:结算逻辑通过辅助函数 enforceDualDodge / enforceDualKill 嵌入「杀」「决斗」
// 的 execute。原因:等待型 atom(询问闪)被 before-hook cancel(如八卦阵判红放虚拟闪)后
// after-hook 不触发,无法用 hook 拦截追加第二轮询问。故在 execute 内 applyAtom(询问闪/杀)
// 返回后,由调用方主动检查 source 是否拥有无双,如是则消耗第一张牌并追加一次询问。
//
// 八卦阵 FAQ 正确支持:八卦阵判定出的闪只算一张,无双下需判两次。
// 第一轮八卦阵判红 → cancel 询问闪 → 杀.execute 仍继续到 enforceDualDodge → 发现处理区有
// 虚拟闪 → 消耗 → 追加第二次询问闪 → 八卦阵再判一次。
import type { GameState, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import type { SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '无双',
    description:
      '锁定技:你使用【杀】的目标需连续出两张【闪】才能抵消;与你【决斗】的角色每次需连续打出两张【杀】',
  };
}

/**
 * 无双·杀:若 source 拥有无双,消耗处理区已有的全部闪牌(移入弃牌堆),
 * 再追加一次 applyAtom(询问闪)。
 *
 * 在 杀.execute 的 applyAtom(询问闪) 之后调用。source 无无双或处理区无闪则 no-op。
 */
export async function enforceDualDodge(
  state: GameState,
  source: number,
  target: number,
): Promise<void> {
  if (!state.players[source]?.skills.includes('无双')) return;
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

/**
 * 无双·决斗:若 otherParty(决斗中拥有无双的一方)有无双,消耗处理区已有的全部杀牌,
 * 再追加一次 applyAtom(询问杀)。
 *
 * 在 决斗.execute 的 applyAtom(询问杀) 之后调用。
 * otherParty 是被询问者(current)的对手 —— 即 询问杀 的 source。
 */
export async function enforceDualKill(
  state: GameState,
  otherParty: number,
  current: number,
): Promise<void> {
  if (!state.players[otherParty]?.skills.includes('无双')) return;
  const firstKills = frameCards(state).filter((id) => state.cardMap[id]?.name === '杀');
  if (firstKills.length === 0) return;
  for (const id of firstKills) {
    await applyAtom(state, {
      type: '移动牌',
      cardId: id,
      from: { zone: '处理区' },
      to: { zone: '弃牌堆' },
    });
  }
  await applyAtom(state, { type: '询问杀', target: current, source: otherParty });
}

export default { createSkill } satisfies SkillModule;
