// 界黄天(界张角·主公技,OL 界限突破官方逐字):
//   主公技,其他群势力角色的出牌阶段限一次,其可以交给你一张【闪】或黑桃手牌。
//
// 界限突破(相对标黄天 src/engine/skills/黄天.ts,经工厂参数注入):
//   标黄天:交一张【闪】或【闪电】。
//   界黄天:交一张【闪】或**黑桃手牌**(任意黑桃花色手牌,不限于闪电)。
//   (闪电本身是♠A,仍被接受;新增接受其他黑桃手牌如♠杀、♠决斗等。)
//
// 其余机制(use action 注册在每个群势力盟友座次上 / validate / execute)与标版一致,
// 复用标版黄天导出的 createHuangtianSkill 工厂(差异仅 技能id/描述/文案/可交牌谓词)。
//
// 命名:文件名/loader key/character skill name 均为 '界黄天';
//   内部 Skill.name = '黄天'(OL 官方技能名,玩家可见)。
import type { SkillModule } from '../types';
import { createHuangtianSkill, type HuangtianOptions } from './黄天';

const OPTIONS: HuangtianOptions = {
  skillId: '界黄天',
  displayName: '黄天', // OL 官方技能名(玩家可见),区别于技能 id
  description: '主公技:其他群势力角色可在出牌阶段将一张【闪】或黑桃手牌交给你',
  lordOnlyError: '界黄天为主公技,界张角非主公',
  cardDesc: '【闪】或黑桃手牌',
  isGiveableCard: (c) => c?.name === '闪' || c?.suit === '♠',
};

export const { createSkill, onInit, onMount } = createHuangtianSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
