// 界观星(界诸葛亮·蜀·主动技,OL hero/442 逐字):
//   "准备阶段,你可以观看牌堆顶的五张牌(存活角色数小于4时改为三张),
//    然后将之以任意顺序置于牌堆顶或牌堆底。若皆置于牌堆底,
//    结束阶段你可以再次发动本技能。"
//
// 与标观星(src/engine/skills/观星.ts)区别(OL 界限突破差异,经工厂参数注入):
//   1. **X 计算**:标版 X = min(全场角色数含阵亡, 5);界版 X = (存活角色数 < 4) ? 3 : 5。
//      即存活角色数 < 4 时降为 3 张(2~3 人残局仍可观 3 张),>=4 时仍为 5。
//   2. **全置底再触发**:若准备阶段所有观察牌皆置于牌堆底,结束阶段可再次发动本技能一次。
//      标版无此机制。一次性的"再次发动"机会,结束阶段消费后失效(不再级联)。
//
// 主流程/respond/onMount 复用 _guanxing.ts 导出的 createGuanxingSkill 工厂
// (触发时机:阶段开始(准备 或 回合结束)after-hook —— 工厂内按 phase 分支,
// 全置底标志为 localVars['界观星/全置底'])。
// 牌堆方向约定(deck 末尾为顶,newDeck 构造)见 _guanxing.ts 文件头。
import { createGuanxingSkill, type GuanxingOptions } from './_guanxing';

const OPTIONS: GuanxingOptions = {
  name: '界观星',
  description:
    '准备阶段,观看牌堆顶 5 张(存活角色数<4 时为 3 张),任意排序置顶/置底;若皆置底,结束阶段可再次发动',
  skillId: '界观星',
  arrangeTitle: '界观星:排列牌堆顶牌',
  // 存活角色数 < 4 → 3(2~3 人残局仍可观 3 张);≥ 4 → 5
  calcX: (state) => (state.players.filter((p) => p.alive).length < 4 ? 3 : 5),
  retriggerAtEndPhase: true,
};

export const { createSkill, onInit, onMount } = createGuanxingSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
