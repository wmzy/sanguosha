// 兵略(王平·蜀·锁定技,风林火山 hero/401 逐字):
//   锁定技,当你首次对一名角色发动"飞军"时,你摸两张牌。
//
// 设计说明:
//   兵略是锁定技,其触发时机是"首次对一名角色发动飞军"——这是飞军 use action
//   execute 流程中的子事件,没有独立的 atom 供 after-hook 挂载。因此兵略的效果
//   由飞军.ts 的 execute 直接触发(检查 owner.skills.includes('兵略') +
//   owner.vars['兵略/已飞军目标'] 首次去重)。
//
//   本模块仅提供技能元数据(createSkill 声明 isLocked=true),onInit/onMount 无操作。
//   兵略的目标去重记录由飞军.ts 写入 owner.vars['兵略/已飞军目标'](number[],整局持久)。
//
//   拆分原因:王平角色定义需要两个独立技能文件(飞军.ts + 兵略.ts),分别注册到
//   skills/index.ts。兵略的存在使飞军 execute 中的摸两张效果有归属(而非硬编码)。
import type { FrontendAPI, GameState, Skill } from '../types';
import type { SkillModule } from '../types';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '兵略',
    description: '锁定技,当你首次对一名角色发动"飞军"时,你摸两张牌',
    isLocked: true,
  };
}

export function onInit(_skill: Skill, _state: GameState): (() => void) | void {
  // 效果由飞军.ts execute 触发,此处无需注册 hook
  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技无主动入口,无前端 action 声明
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
