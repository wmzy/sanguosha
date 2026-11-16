// 观星(诸葛亮·主动技):准备阶段开始时,你可以观看牌堆顶的 X 张牌
// (X 为全场角色数且至多为 5),改变其中任意数量牌的顺序置于牌堆顶,
// 其余的牌置于牌堆底。
//
// 触发时机:阶段开始(准备) after-hook(参考洛神)。
// 主流程/respond/onMount 复用 _guanxing.ts 导出的 createGuanxingSkill 工厂
// (标/界观星仅差 calcX 与界版「全置底再触发」附加段)。
// 牌堆方向约定(deck 末尾为顶,newDeck 构造)见 _guanxing.ts 文件头。
import { createGuanxingSkill, type GuanxingOptions } from './_guanxing';

const OPTIONS: GuanxingOptions = {
  name: '观星',
  description: '准备阶段开始时,观看牌堆顶X张牌(X为全场角色数至多5),调整顺序,余者置牌堆底',
  skillId: '观星',
  arrangeTitle: '观星：排列牌堆顶牌',
  // X = 全场角色数(含已阵亡,非存活角色数),至多 5
  calcX: (state) => Math.min(state.players.length, 5),
};

export const { createSkill, onInit, onMount } = createGuanxingSkill(OPTIONS);

export default { createSkill, onInit, onMount };
