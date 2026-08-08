// 古锭刀(武器,攻击范围 2):
//   锁定技,每当你使用【杀】对目标角色造成伤害时,若其没有手牌,你令伤害值+1。
//
// 实现:挂在「造成伤害时」before-hook(加伤时机),满足以下条件则 amount +1:
//   - 伤害来源是自己(atom.source === ownerId)
//   - 装备了古锭刀(防御性校验,与麒麟弓一致)
//   - 伤害来源牌是「杀」(普通/火/雷杀 name 均为 '杀')
//   - 目标没有手牌
// 锁定技,无需询问玩家,无需 onMount(无 respond 窗口)。
import type { HookResult, Skill, GameState } from '../types';
import { registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '古锭刀',
    description: '锁定技,当你使用杀造成伤害时,若目标没有手牌,此伤害+1。',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      const baseAmount = atom.amount ?? 0;
      if (baseAmount <= 0) return;

      // 防御性校验:装备了古锭刀(技能实例随装备挂载/卸载,此校验与麒麟弓一致)
      const self = ctx.state.players[ownerId];
      if (!self) return;
      const weaponId = self.equipment['武器'];
      if (!weaponId) return;
      const weapon = ctx.state.cardMap[weaponId];
      if (weapon?.name !== '古锭刀') return;

      // 仅限【杀】造成的伤害才触发(普通/火/雷杀 name 均为 '杀')。
      const damageCardId = atom.cardId;
      if (!damageCardId) return;
      const damageCard = ctx.state.cardMap[damageCardId];
      if (damageCard?.name !== '杀') return;

      // 目标没有手牌才加伤
      const targetIdx = atom.target;
      if (typeof targetIdx !== 'number') return;
      const target = ctx.state.players[targetIdx];
      if (!target) return;
      if (target.hand.length > 0) return;

      return {
        kind: 'modify',
        atom: { ...ctx.atom, amount: baseAmount + 1 } as typeof ctx.atom,
      };
    },
  );

  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
