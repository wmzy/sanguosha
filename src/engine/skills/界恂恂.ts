// 界恂恂(界李典·主动技,OL 界限突破官方逐字):
//   "摸牌阶段开始时,你可以观看牌堆顶的四张牌,
//    然后将其中两张牌置于牌堆顶,将剩余牌置于牌堆底。"
//
// 触发时机:阶段开始(摸牌) after-hook(player===ownerId)。
// 阶段开始 atom 仅更新 state.phase;随后引擎另行执行实际摸牌(摸牌 atom),
// after-hook 在 phase 切换后、实际摸牌前执行,故重排可影响本次摸牌。
//
// 主流程/respond/onMount 复用 _guanxing.ts 导出的 createGuanxingSkill 工厂
// (与 观星/界观星 同构,仅 摸牌阶段触发/固定观察 4 张/恰好 2 张置顶 经参数注入;
// 恂恂 的 arrange 弹窗无 description、confirm 询问带观察张数描述,亦经参数注入)。
// 牌堆方向约定(deck 末尾为顶,newDeck 构造)见 _guanxing.ts 文件头。
//
// 命名:文件名/loader key/character skill name 均为 '界恂恂'(避开未来标版 '恂恂' 冲突);
//   内部 Skill.name = '恂恂'(OL 官方技能名,玩家可见),requestType 前缀 '界恂恂',
//   localVars 键/错误文案前缀 '恂恂'(经 varsPrefix 注入)。
import { createGuanxingSkill, type GuanxingOptions } from './_guanxing';

/** 观看牌堆顶的固定张数(OL 官方) */
const REVEAL_COUNT = 4;

/** 须恰好置于牌堆顶的张数(OL 官方"将其中两张置于牌堆顶";牌堆不足时取可用张数) */
const REQUIRED_TOP = 2;

const OPTIONS: GuanxingOptions = {
  name: '恂恂',
  description: '摸牌阶段开始时,观看牌堆顶4张牌,将其中2张置于牌堆顶,其余置于牌堆底',
  skillId: '界恂恂',
  varsPrefix: '恂恂',
  phase: '摸牌',
  calcX: () => REVEAL_COUNT,
  requiredTop: REQUIRED_TOP,
  confirmDescription: (drawCount) => `观看牌堆顶 ${drawCount} 张牌,选择置顶与置底`,
  arrangeDescription: null,
  arrangeTitle: (drawCount) =>
    `恂恂:选择 ${Math.min(REQUIRED_TOP, drawCount)} 张置于牌堆顶(顺序即摸牌顺序),其余置于牌堆底`,
};

export const { createSkill, onInit, onMount } = createGuanxingSkill(OPTIONS);

export default { createSkill, onInit, onMount };
