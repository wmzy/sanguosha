// 界奇才(界黄月英·锁定技):你使用任何锦囊牌无距离限制;
//   其他角色不能弃置你装备区里的防具或宝物牌。
//
// OL 官方(hero/442)逐字:
//   "锁定技,你使用锦囊牌无距离限制。当其他角色弃置你装备区里的防具或宝物牌时,你防止之。"
//
// 实现机制(横切规则,用标签):
//   1. 无距离限制:onInit 给 owner 打标签「奇才/无距离限制」(直接 mutate player.tags,
//      与马匹技能 mutate vars 同模式——tags 不进 GameView,无视图同步负担)。
//      顺手牵羊(标准三国杀中唯一受距离限制的即时锦囊)在 validate 中检查该标签,
//      有则跳过 effectiveDistance 校验。卸载时清除标签。
//
//   2. 防具/宝物保护:onInit 给 owner 打标签「奇才/防具保护」与「奇才/宝物保护」。
//      过河拆桥(唯一弃置其他角色装备区的锦囊)在 validate / 选牌面板 中按槽位检查
//      对应标签:有则将防具/宝物从可弃置列表中过滤。卸载时清除标签。
//
// 注:即时锦囊仅【顺手牵羊】受距离限制;【借刀杀人】的约束是武器/杀目标,非距离。
//     过河拆桥是唯一能"弃置"其他角色装备的途径(顺手牵羊是"获得",不受防具保护影响)。
//
//   2b. 防具/宝物保护(主动拦截):onInit 注册 before-hook 到「请求回应」atom,
//       拦截过河拆桥选牌请求(requestType='过河拆桥_选牌',目标为 owner),在 toViewEvents
//       之前就地过滤 prompt.equipment 中的防具/宝物 → 前端不展示、不可选。
//       选牌面板/过河拆桥 不再 import 本模块(解耦),保护逻辑收敛到本 hook。
import type { Skill, GameState } from '../types';
import { registerBeforeHook } from '../skill';

/** 奇才横切标签:持有者使用锦囊牌时忽略距离限制(由 顺手牵羊 validate 消费) */
export const QICAI_TAG = '奇才/无距离限制';

/** 奇才横切标签:其他角色不能弃置持有者装备区的防具(由 过河拆桥 选牌消费) */
export const QICAI_ARMOR_TAG = '奇才/防具保护';

/** 奇才横切标签:其他角色不能弃置持有者装备区的宝物(由 过河拆桥 选牌消费) */
export const QICAI_TREASURE_TAG = '奇才/宝物保护';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界奇才',
    description: '锁定技:你使用任何锦囊牌无距离限制;其他角色不能弃置你装备区的防具或宝物',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const player = state.players[ownerId];
  if (player) {
    if (!player.tags.includes(QICAI_TAG)) player.tags.push(QICAI_TAG);
    if (!player.tags.includes(QICAI_ARMOR_TAG)) player.tags.push(QICAI_ARMOR_TAG);
    if (!player.tags.includes(QICAI_TREASURE_TAG)) player.tags.push(QICAI_TREASURE_TAG);
  }

  // 主动拦截:过河拆桥选牌请求(目标为 owner)时,在 toViewEvents 前就地过滤
  // prompt.equipment 中的防具/宝物 → 前端不展示、不可选、超时 fallback 也不命中。
  // 顺手牵羊(获得,requestType='顺手牵羊_选牌')不拦截 → 仍可获得装备。
  const unloadHook = registerBeforeHook(state, skill.id, ownerId, '请求回应', async (ctx) => {
    const atom = ctx.atom as {
      requestType?: string;
      prompt?: {
        target?: number;
        equipment?: Array<{ slot: string; cardId: string }>;
      };
    };
    // 仅拦截过河拆桥的弃置选牌请求
    if (atom.requestType !== '过河拆桥_选牌') return;
    const targetIdx = atom.prompt?.target;
    if (typeof targetIdx !== 'number') return;
    // 仅保护 owner 自己的装备
    if (targetIdx !== ownerId) return;
    // 就地过滤掉受保护的槽位(防具/宝物)
    if (atom.prompt?.equipment) {
      atom.prompt.equipment = atom.prompt.equipment.filter((e) => {
        if (e.slot === '防具') return false; // 奇才保护防具
        if (e.slot === '宝物') return false; // 奇才保护宝物
        return true;
      });
    }
  });

  return () => {
    unloadHook();
    const p = state.players[ownerId];
    if (p)
      p.tags = p.tags.filter(
        (t) => t !== QICAI_TAG && t !== QICAI_ARMOR_TAG && t !== QICAI_TREASURE_TAG,
      );
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
