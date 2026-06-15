// 寒冰剑(武器,攻击范围 2):
//   每当你使用【杀】对目标造成伤害时,你可以防止此伤害,改为弃置其两张牌。
import type { AtomBeforeContext, HookResult, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '寒冰剑', description: '武器:杀造成伤害时可改为弃目标2张牌' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'respond',
    (state, params) => {
      if (state.pendingSlot?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (state.pendingSlot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '寒冰剑/confirm') return '当前不是寒冰剑确认';
      return null;
    },
    async (state, params) => {
      state.localVars['寒冰剑/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
    const atom = ctx.atom as { source?: number; target?: number };
    if (atom.source !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const weaponId = self.equipment?.['武器'];
    if (!weaponId) return;
    const weapon = ctx.state.cardMap[weaponId];
    if (!weapon || weapon.name !== '寒冰剑') return;
    const target = ctx.state.players[atom.target!];
    if (!target || target.hand.length === 0) return;

    // 询问是否发动
    delete ctx.state.localVars['寒冰剑/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '寒冰剑/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '寒冰剑:是否改为弃目标2张牌?', confirmLabel: '弃牌', cancelLabel: '正常伤害' },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars['寒冰剑/confirmed']) return;

    // 弃目标最多2张牌
    const cards = target.hand.slice(0, 2);
    await applyAtom(ctx.state, { type: '弃置', player: atom.target!, cardIds: cards });
    delete ctx.state.localVars['寒冰剑/confirmed'];
    return { kind: 'cancel' };
  });
  return () => {};
}

