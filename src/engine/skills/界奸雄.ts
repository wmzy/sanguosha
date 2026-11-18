// 界奸雄(界曹操·被动技):当你受到伤害后,你可以摸一张牌,并获得造成此伤害的牌。
//   (官方逐字,OL 官网 hero/311 + docs/research/武将技能/魏国/界曹操.md——两项效果,非二选一。)
//   无来源伤害(闪电等)无牌可获得:仍可发动,但只摸一张牌(官网 FAQ 2016-11-01)。
//   与标版区别:标版仅获得造成此伤害的牌,无摸牌段。
//
// 实现复用标版奸雄导出的 createJianxiongSkill 工厂(src/engine/skills/奸雄.ts),
// 仅注入差异:chooseRt='界奸雄/choose'、drawOne=true(发动后先摸一张;无伤害牌时
// 仍询问、只摸一张)。延迟拿取时序见工厂文件头注释;摸一张牌无处理区归属问题,
// 在受伤害 hook 内直接 摸牌 count=1(先摸后延迟获得,结果与官方语序一致)。
import { createJianxiongSkill, type JianxiongOptions } from './奸雄';
import type { SkillModule } from '../types';

const OPTIONS: JianxiongOptions = {
  skillId: '界奸雄',
  chooseRt: '界奸雄/choose',
  description: '当你受到伤害后,你可以摸一张牌,并获得造成此伤害的牌',
  drawOne: true,
};

export const { createSkill, onInit, onMount } = createJianxiongSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
