// 奇才(黄月英·锁定技):你使用任何锦囊牌无距离限制。
//
// 实现机制(横切规则,用标签):
//   onInit 给 owner 打标签「奇才/无距离限制」(直接 mutate player.tags,
//   与马匹技能 mutate vars 同模式——tags 不进 GameView,无视图同步负担)。
//   顺手牵羊(标准三国杀中唯一受距离限制的即时锦囊)在 validate 中检查该标签,
//   有则跳过 effectiveDistance 校验。卸载时清除标签。
//
// 注:即时锦囊仅【顺手牵羊】受距离限制;【借刀杀人】的约束是武器/杀目标,非距离。
import type { Skill, GameState } from '../types';

/** 奇才横切标签:持有者使用锦囊牌时忽略距离限制(由 顺手牵羊 validate 消费) */
export const QICAI_TAG = '奇才/无距离限制';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '奇才', description: '锁定技:你使用任何锦囊牌无距离限制', isLocked: true };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const player = state.players[ownerId];
  if (player && !player.tags.includes(QICAI_TAG)) player.tags.push(QICAI_TAG);
  return () => {
    const p = state.players[ownerId];
    if (p) p.tags = p.tags.filter((t) => t !== QICAI_TAG);
  };
}
