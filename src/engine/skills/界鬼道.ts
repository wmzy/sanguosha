// 界鬼道(界张角·被动触发,OL 界限突破官方逐字):
//   当一张判定牌生效前,你可以用一张黑色牌替换之,若此黑色牌为黑桃2~9,你摸一张牌。
//
// 界限突破(相对标鬼道 src/engine/skills/鬼道.ts):机制(registerJudgeModifier /
// respond action / replaceJudgeCard 改判)与标版一致,复用其 createJudgeReplaceSkill
// 工厂,仅注入差异参数:
//   1. 文案前缀 '界鬼道'(询问/报错文案),并附 '(黑桃2~9摸一张)' 提示后缀;
//      requestType/localVars 键独立('界鬼道/…',与标版键隔离);
//   2. 替换牌为黑桃2~9 → 额外摸一张牌(onReplaced)。
//
// 命名:文件名/loader key/character skill name 均为 '界鬼道';
//   内部 Skill.name = '鬼道'(OL 官方技能名,玩家可见)。
import type { Card } from '../types';
import { applyAtom } from '../core/apply';
import { createJudgeReplaceSkill, type JudgeReplaceOptions } from './鬼道';

/** 判断一张牌的点数是否为 2~9 */
function isRank2to9(rank: string): boolean {
  const n =
    rank === 'A'
      ? 1
      : rank === 'J'
        ? 11
        : rank === 'Q'
          ? 12
          : rank === 'K'
            ? 13
            : parseInt(rank, 10);
  return !Number.isNaN(n) && n >= 2 && n <= 9;
}

/** 判断一张牌是否为黑桃2~9(触发界鬼道摸牌效果) */
function isSpade2to9(card: Card | undefined): boolean {
  return !!card && card.suit === '♠' && isRank2to9(card.rank);
}

const OPTIONS: JudgeReplaceOptions = {
  name: '鬼道',
  description: '判定牌生效前,你可以用一张黑色牌替换之,若为黑桃2~9,你摸一张牌',
  replaceRequestType: '界鬼道/replace',
  replaceCardKey: '界鬼道/replaceCard',
  promptName: '界鬼道',
  colorFilter: (c) => c.color === '黑',
  hint: '(黑桃2~9摸一张)',
  onReplaced: async (state, ownerId, replaceCardId) => {
    // 界限突破新增:替换牌为黑桃2~9 → 摸一张牌
    if (isSpade2to9(state.cardMap[replaceCardId])) {
      await applyAtom(state, { type: '摸牌', player: ownerId, count: 1 });
    }
  },
};

export const { createSkill, onInit, onMount } = createJudgeReplaceSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
