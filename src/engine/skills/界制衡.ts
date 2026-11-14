// 界制衡(界孙权·主动技):
//   出牌阶段限一次:你可以弃置任意张牌,然后摸等量张牌,
//   若你以此法弃置了所有手牌,你额外摸一张牌。
//
// OL 官方(hero/442)逐字:
//   "你可以弃置任意张牌,然后摸等量张牌,若你以此法弃置了所有手牌,你额外摸一张牌。"
//
// 与标制衡区别(经 制衡.ts 导出的 createZhihengSkill 工厂参数注入,参照 八阵.ts
// 复用 八卦阵.ts 工厂的做法):
//   - 标版无"弃置所有手牌额外摸一张"奖励;界版有此奖励(bonusDrawWhenAllHandDiscarded)。
//   - "任意张牌"= 手牌+装备均可弃(标版引擎本就支持,界版沿用)。
//   - 标版 validate 有 cardIds 去重校验,界版历史现状无(为行为等价保留差异,不注入)。
//   - 独立界版技能文件,不修改标制衡。限一次标记键为 '界制衡'(与标制衡键隔离,互不影响)。
import { createZhihengSkill } from './制衡';

export const { createSkill, onInit, onMount } = createZhihengSkill({
  name: '界制衡',
  description:
    '出牌阶段限一次:弃任意张牌(手牌/装备),摸等量张;若弃置了所有手牌,额外摸一张',
  mountTitle: '界制衡:选择要弃置的牌(手牌+装备均可;若弃置所有手牌,额外多摸一张)',
  bonusDrawWhenAllHandDiscarded: true,
});

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
