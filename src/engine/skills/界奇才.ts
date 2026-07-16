// 界奇才(界黄月英·锁定技):你使用任何锦囊牌无距离限制;其他角色不能弃置你装备区里的防具牌。
//
// 实现机制(横切规则,用标签):
//   1. 无距离限制:onInit 给 owner 打标签「奇才/无距离限制」(直接 mutate player.tags,
//      与马匹技能 mutate vars 同模式——tags 不进 GameView,无视图同步负担)。
//      顺手牵羊(标准三国杀中唯一受距离限制的即时锦囊)在 validate 中检查该标签,
//      有则跳过 effectiveDistance 校验。卸载时清除标签。
//
//   2. 防具保护:onInit 给 owner 额外打标签「奇才/防具保护」。
//      过河拆桥(唯一弃置其他角色装备区的锦囊)在选牌时检查该标签,
//      有则将防具从可弃置列表中过滤。卸载时清除标签。
//
// 注:即时锦囊仅【顺手牵羊】受距离限制;【借刀杀人】的约束是武器/杀目标,非距离。
//     过河拆桥是唯一能"弃置"其他角色装备的途径(顺手牵羊是"获得",不受防具保护影响)。
import type { Skill, GameState } from '../types';

/** 奇才横切标签:持有者使用锦囊牌时忽略距离限制(由 顺手牵羊 validate 消费) */
export const QICAI_TAG = '奇才/无距离限制';

/** 奇才横切标签:其他角色不能弃置持有者装备区的防具(由 过河拆桥 选牌消费) */
export const QICAI_ARMOR_TAG = '奇才/防具保护';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界奇才',
    description: '锁定技:你使用任何锦囊牌无距离限制;其他角色不能弃置你装备区的防具',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const player = state.players[ownerId];
  if (player) {
    if (!player.tags.includes(QICAI_TAG)) player.tags.push(QICAI_TAG);
    if (!player.tags.includes(QICAI_ARMOR_TAG)) player.tags.push(QICAI_ARMOR_TAG);
  }

  return () => {
    const p = state.players[ownerId];
    if (p) p.tags = p.tags.filter((t) => t !== QICAI_TAG && t !== QICAI_ARMOR_TAG);
  };
}

export function onMount() {
  // 奇才是纯被动锁定技,无前端 action 定义
}

export default {
  createSkill,
  onInit,
  onMount,
} satisfies import('../types').SkillModule;
