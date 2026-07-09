// 限一次/回合(usedThisTurn)工具三件套。
//
// 抽自 21 个技能重复的"限一次"仪式:validate 读 vars、execute 同步写 vars + 回合用量
// atom 投影 view、activeWhen 叠加 defaultPlayActive + turnUsage 判定。统一到此处,消除样板。
// key 恒为 技能名(中文) + '/usedThisTurn',由「回合结束」atom 自动清空(后缀约定)。
import type { GameState, ActionContext } from './types';
import { applyAtom } from './create-engine';
import { defaultPlayActive } from './action-active';

const SUFFIX = '/usedThisTurn';

/** 某技能本回合是否已用过(限一次)。读 player.vars。 */
export function usedThisTurn(state: GameState, ownerId: number, skillName: string): boolean {
  return !!state.players[ownerId]?.vars[skillName + SUFFIX];
}

/** 标记技能本回合已用(限一次):同步设 vars + 回合用量 atom 同步 view。
 *  必须在 execute 第一个 await 之前调用,以防 dispatch 重入(见制衡.ts 注释)。 */
export async function markOncePerTurn(state: GameState, ownerId: number, skillName: string): Promise<void> {
  state.players[ownerId].vars[skillName + SUFFIX] = true;
  await applyAtom(state, { type: '回合用量', player: ownerId, key: skillName + SUFFIX, value: true });
}

/** activeWhen 谓词:默认出牌条件 + 本回合未用过该技能。 */
export function activeUnlessUsedThisTurn(skillName: string): (ctx: ActionContext) => boolean {
  return (ctx: ActionContext): boolean =>
    defaultPlayActive(ctx) && !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[skillName + SUFFIX];
}
