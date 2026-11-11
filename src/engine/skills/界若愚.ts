// 界若愚(界刘禅·觉醒主公技):主公技,觉醒技,准备阶段,若你是全场体力值最小的角色,
// 你增加1点体力上限,回复至3点体力,然后获得"激将""思蜀"。
//
// 与标版若愚(src/engine/skills/若愚.ts)区别(经 createAwakenLordSkill 差异参数注入):
//   1. 回复量:标版「回复1点体力」;界版「回复至3点体力」(若当前<3 则补到 3,已≥3 不变)。
//   2. 觉醒标记独立:player.vars['界若愚/awakened'](与标版若愚键隔离)。
//   3. 获得技能:标版仅获「激将」;界版亦获「激将」(「思蜀」尚未实现,暂不添加)。
//
// 触发时机/主公判定/觉醒仪式与标版完全一致,复用标版工厂实现;
// 注册键 '界若愚'(与标版若愚键隔离,不修改标版)。
import { createAwakenLordSkill, type AwakenLordOptions } from './若愚';

/** 回复目标体力值:回复至 3 点(当前已≥3 则回复量为 0,不回复) */
const TARGET_HEALTH = 3;

const OPTIONS: AwakenLordOptions = {
  name: '界若愚',
  description:
    '主公技/觉醒技:回合开始且体力全场最少时,增加1体力上限、回复至3点体力并永久获得"激将"',
  awakenedKey: '界若愚/awakened',
  healAmount: (self) => Math.max(0, TARGET_HEALTH - self.health),
};

export const { createSkill, onInit, onMount } = createAwakenLordSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
