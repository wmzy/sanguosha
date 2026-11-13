// 界闭月(界貂蝉·群·被动技,OL 界限突破官方逐字):
//   结束阶段,若你没有手牌,你可以摸两张牌,否则你可以摸一张牌。
//
// 界限突破(相对标闭月 src/engine/skills/闭月.ts):
//   1. 标闭月:回合结束阶段,你可以摸一张牌。
//   2. 界闭月:无手牌时摸 2 张,有手牌时摸 1 张——新增"无手牌摸两张"强化效果。
//
// 实现:复用 闭月.ts 导出的 createEndPhaseDrawSkill 工厂(respond 注册/回合结束
// after-hook/onMount 骨架逐字同标版),仅注入差异参数:
//   1. requestType/localVars 键独立('界闭月/…',与标版键隔离);
//   2. 摸牌张数 drawCount:hook 触发瞬间读 self.hand.length(此时为回合结束阶段开始,
//      弃牌阶段已结束,手牌数已稳定)——0 张 → 2 张,否则 → 1 张(询问标题随之动态);
//   3. onMount confirm 标题无"(摸X张牌)"后缀。
//   询问/报错文案与标版一致('是否发动闭月?(摸…)'/'当前不是闭月确认')。
import type { SkillModule } from '../types';
import { createEndPhaseDrawSkill, type EndPhaseDrawOptions } from './闭月';

const SKILL_ID = '界闭月';

const OPTIONS: EndPhaseDrawOptions = {
  name: '闭月',
  description: '结束阶段,若你没有手牌,你可以摸两张牌,否则你可以摸一张牌',
  requestType: `${SKILL_ID}/confirm`,
  confirmedKey: `${SKILL_ID}/confirmed`,
  drawCount: (self) => (self.hand.length === 0 ? 2 : 1),
  mountTitle: '是否发动闭月?',
};

export const { createSkill, onInit, onMount } = createEndPhaseDrawSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
