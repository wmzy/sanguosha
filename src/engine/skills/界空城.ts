// 界空城(界诸葛亮·锁定技):若你没有手牌,你不是【杀】和【决斗】的合法目标;
// 你使用的【杀】被【闪】抵消后,可以摸一张牌。
//
// 实现:
//   1. before-hook 挂「成为目标」(结算阶段第一个 atom):
//      无手牌时不是 杀/决斗 合法目标——与标版空城共用 registerKongchengGuard(见 空城.ts)。
//
//   2. after-hook 挂「被抵消」:检测自己使用的杀被闪抵消 → 摸一张牌。
//      实现模式与界张飞咆哮(界咆哮.ts)完全一致。
import type { Skill, GameState, SkillModule } from '../types';
import { applyAtom } from '../core/apply'
import { registerOnOwnSlashDodged } from '../util/skillRuntime';
import { registerKongchengGuard } from './空城';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界空城',
    description: '锁定技:若你没有手牌,你不是杀和决斗的合法目标;你使用的杀被闪抵消后摸一张牌',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // before-hook:无手牌时不能成为 杀/决斗 的目标(与标版空城共用)
  const unregBefore = registerKongchengGuard(state, skill.id, ownerId);

  // 杀被闪抵消后摸一张牌(与界张飞咆哮同款:武将技形态,不传 weaponName)
  const unregAfter = registerOnOwnSlashDodged(state, skill.id, ownerId, async (ctx) => {
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
  });

  return () => {
    unregBefore();
    unregAfter();
  };
}

export default { createSkill, onInit } satisfies SkillModule;
