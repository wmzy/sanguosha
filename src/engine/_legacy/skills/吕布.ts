// engine/skills/吕布.ts — 吕布
//
// 无双 v2 stub：handler 空 []，v2 派发本就无效。
// 真实判定走 hasSkill(state, player, '无双')（card-handlers handleKillCard
// 计算 hasWushuang）。详见 [P5-T2] ADR。
// 阶段 D 删 state.triggers 后本 v2 trigger 兜底自然失效——已显式删除。
//
// 历史：v2 trigger = '杀命中'，仅作占位 stub。
import type { SkillDef } from '../types';

// ==================== 吕布 ====================

export const skills: SkillDef[] = [
  {
    id: '无双',
    name: '无双',
    description: '锁定技，你使用的【杀】需两张【闪】才能抵消；与你进行【决斗】的角色每次需打出两张【杀】。',
    handler(_ctx, _state) {
      return [];
    },
  },
];