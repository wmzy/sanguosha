// 帷幕(贾诩·群·锁定技):你不能成为黑色锦囊的目标。
//
// 实现:registerCardInvalidation 原语在 7 个拦截点(成为目标/检测有效性/询问杀/
//   受到伤害时/获得/弃置/设横置)统一 cancel,谓词 isBlackTrick——只按黑色锦囊牌的
//   颜色判定,不与具体锦囊名耦合。黑色 = card.color === '黑'(♠/♣)。
//
//   非锦囊结算帧(如弃牌阶段、反馈/突袭等)无有效 cardId → card=undefined → 谓词 false;
//   红色锦囊 → false;黑色锦囊 → true → 拦截。
//
//   锦囊卡 id 来源:成为目标/检测有效性/受到伤害时 由 atom.cardId 直接给出;
//   询问杀/获得/弃置/设横置 由顶帧 frame.params.cardId 给出(由原语内部解析)。
import type { Skill, GameState, Card } from '../types';
import { registerCardInvalidation } from '../core/card-invalidation';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '帷幕',
    description: '锁定技:你不能成为黑色锦囊的目标',
    isLocked: true,
  };
}

/** 判定一张卡是否为黑色锦囊牌 */
function isBlackTrick(card: Card | undefined): boolean {
  return !!card && card.type === '锦囊牌' && card.color === '黑';
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 拦截:黑色锦囊对贾诩无效(7 个拦截点统一交给 registerCardInvalidation)──
  //   cardId 来源(逐 atom):成为目标/检测有效性/受到伤害时 用 atom.cardId;
  //   询问杀/获得/弃置/设横置 用 topFrame(state).params.cardId(由原语内部解析)。
  return registerCardInvalidation(state, skill.id, ownerId, (_st, card) =>
    isBlackTrick(card),
  );
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
