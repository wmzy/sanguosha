// 界志继(界姜维·觉醒技,OL 界限突破官方逐字):
//   觉醒技,准备阶段或结束阶段,若你没有手牌,你须回复1点体力或摸两张牌,
//   然后减1点体力上限,并永久获得技能"观星"。
//
// 与原版志继差异:触发时机(原版仅准备阶段;界版额外可在结束阶段触发)。
//   原版姜维:准备阶段(「阶段开始」atom,phase='准备' 的 after-hook)
//   界姜维:准备阶段 **或结束阶段**(「阶段开始」atom,phase='准备' 或 '回合结束' 的 after-hook)
//
// 觉醒流程/respond/onMount 复用标版志继导出的 createZhijiSkill 工厂
// (差异仅 描述/询问 requestType/触发阶段;觉醒标记与选择键共享 '志继/awakened'、
//  '志继/choice'——同一角色只会拥有一版志继)。
// 防重入:AWAKENED_KEY 在 awaken 入口即设,准备阶段触发后即使结束阶段无手牌也不会再触发。
import { createZhijiSkill, type ZhijiOptions } from './志继';

const OPTIONS: ZhijiOptions = {
  description: '觉醒技:准备阶段或结束阶段且无手牌时,回复1体力或摸2牌,减1体力上限并永久获得"观星"',
  chooseRt: '界志继/choose',
  triggerPhases: ['准备', '回合结束'],
};

export const { createSkill, onInit, onMount } = createZhijiSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
