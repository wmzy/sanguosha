// 寸目(许攸·群·锁定技,OL hero/406 风林火山官方逐字):
//   "锁定技,当你摸牌时,你改为从牌堆底摸牌。"
//
// 实现机制(before-hook modify on 摸牌):
//   牌堆方向约定(与 摸牌 atom 一致):deck[0]=牌堆底(最后摸),deck[末尾]=牌堆顶(最先摸)。
//   onInit 注册 before-hook 监听 摸牌,当摸牌者为 owner 时,把 atom modify 为
//   { ...atom, fromBottom: true }。摸牌 atom 的 planDraw/apply 据 fromBottom
//   从牌堆底(deck 开头)抽牌。before-hook 折叠为单趟执行(无重入),不会循环。
//
// 覆盖范围:owner 的所有摸牌(摸牌阶段默认摸牌、成略/恃才/其它技能触发的摸牌)
// 均走 摸牌 atom → 本 hook 改为从牌堆底摸。判定(判定.ts 直接 shift deck[0])不走
// 摸牌 atom,不受影响。
import type { GameState, Skill } from '../types';
import { registerBeforeHook } from '../core/skill';
import type { SkillModule } from '../types';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '寸目',
    description: '锁定技:当你摸牌时,你改为从牌堆底摸牌',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  // 摸牌前:owner 摸牌改为从牌堆底摸(modify fromBottom=true)。
  registerBeforeHook(state, skill.id, ownerId, '摸牌', async (ctx) => {
    if (ctx.atom.player !== ownerId) return;
    // 已是 fromBottom(理论上不会),避免重复 modify
    if (ctx.atom.fromBottom) return;
    return { kind: 'modify', atom: { ...ctx.atom, fromBottom: true } };
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit };
export default _skillModule;
