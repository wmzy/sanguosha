// 界护驾(界曹操·主公技):
//   主公技,其他魏势力角色可以在你需要时代替你使用或打出【闪】(视为由你使用或打出);
//   每回合限一次,当其他魏势力角色于其回合外使用或打出【闪】时,
//   其可以令你摸一张牌。
//
// OL 官方:
//   "主公技,其他魏势力角色可以在你需要时代替你使用或打出【闪】(视为由你使用或打出);
//    每回合限一次,当其他魏势力角色于其回合外使用或打出【闪】时,
//    其可以令你摸一张牌。"
//
// 与标护驾区别:
//   - 标护驾:仅主动技形式(曹操被询问闪 → 逐个询问魏角色代出闪)。
//   - 界护驾:① 沿用标护驾主动技机制;② 新增被动触发——魏角色回合外用闪
//     (使用/打出/护驾代出),其可令曹操摸1张(每回合限一次,选择权在该魏角色)。
//
// 实现/交互复用标版护驾导出的 createHujiaSkill 工厂,仅注入差异:
//   - 键空间按技能 id '界护驾' 隔离(界护驾/出闪、界护驾/drawChoice、界护驾/闪出、
//     界护驾/confirmed、界护驾/triggered)。
//   - 主公校验:仅曹操为主公(座次 0)时可发动(ownerId===0 门槛)。
//   - 被动触发(移动牌 after-hook):魏角色回合外打出闪(手牌→处理区)→ 询问是否令曹操摸1。
//     "使用/打出闪" 均会触发 移动牌 atom(闪 use 流程必经),覆盖主路径。
//     "每回合限一次":用 state.turn.vars[界护驾/triggered](回合结束 atom 自动清空 turn.vars)。
//   - 跨座次 respond 注册:选择权在魏角色(非曹操),须为每个魏角色座次注册 respond,
//     否则其 dispatch 找不到 action(同标护驾 跨座次注册模式);界版同一注册分流
//     出闪 + drawChoice 两个询问。
import { createHujiaSkill, type HujiaOptions } from './护驾';
import type { SkillModule } from '../types';

const OPTIONS: HujiaOptions = {
  skillId: '界护驾',
  displayName: '界护驾',
  description:
    '主公技:魏势力角色可代你使用或打出闪;每回合限一次,魏角色回合外用闪时可令你摸1张',
  lordOnly: true,
  passiveDraw: true,
  declareAltFirst: true,
  unloadAll: true,
};

export const { createSkill, onInit, onMount } = createHujiaSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
