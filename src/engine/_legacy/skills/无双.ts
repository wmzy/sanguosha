// @ts-nocheck
// engine/skills/无双.ts — 无双（吕布）v2 stub
//
// 真实判定走 hasSkill(state, player, '无双')（card-handlers handleKillCard
// 计算 hasWushuang），不再依赖 v2 trigger.event 派发。详见 [P5-T2] ADR。
// 阶段 D 删 state.triggers 后本 v2 trigger 兜底自然失效——已显式删除。
//
// 历史：本技能 v2 trigger = '杀命中'，handler 是空 []，仅作为占位。
// 真正行为（杀需 2 闪）由 card-handlers.ts 主动 hasSkill 判定。
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '无双',
  name: '无双',
  description: '锁定技，你使用的【杀】需两张【闪】才能抵消；与你进行【决斗】的角色每次需打出两张【杀】。',
  handler(_ctx, _state) {
    return [];
  },
};