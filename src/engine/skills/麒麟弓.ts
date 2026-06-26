// 麒麟弓(武器,攻击范围 5):
//   每当你使用【杀】对目标角色造成伤害时,你可以弃置其1张坐骑牌(+1马或-1马)。
//   不防止伤害——只是额外弃马(与寒冰剑的关键区别)。
import type { AtomBeforeContext, FrontendAPI, HookResult, Json, Skill, GameState} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '麒麟弓', description: '武器:杀造成伤害时可弃目标1匹马' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // ── respond:玩家确认是否发动 ──
  registerAction(state, skill.id, ownerId, 'respond',
    (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是麒麟弓窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '麒麟弓/confirm') return '当前不是麒麟弓窗口';
      void params;
      return null;
    },
    async (state, params) => {
      state.localVars['麒麟弓/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 造成伤害 before hook:杀命中后额外弃马 ──
  registerBeforeHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
    const atom = ctx.atom as { source?: number; target?: number; cardId?: string };
    if (atom.source !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const weaponId = self.equipment['武器'];
    if (!weaponId) return;
    const weapon = ctx.state.cardMap[weaponId];
    if (!weapon || weapon.name !== '麒麟弓') return;
    const targetIdx = atom.target;
    if (typeof targetIdx !== 'number') return;
    const target = ctx.state.players[targetIdx];
    if (!target) return;

    // 目标至少有一匹马(进攻马或防御马)才可发动
    const mountSlots: Array<'进攻马' | '防御马'> = ['进攻马', '防御马'];
    const ownedMounts = mountSlots.filter(slot => !!target.equipment?.[slot]);
    if (ownedMounts.length === 0) return;

    // 询问是否发动
    delete ctx.state.localVars['麒麟弓/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '麒麟弓/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '麒麟弓:是否弃目标1匹马?', confirmLabel: '弃马', cancelLabel: '不发动' },
      timeout: 10,
    });
    if (!ctx.state.localVars['麒麟弓/confirmed']) {
      delete ctx.state.localVars['麒麟弓/confirmed'];
      return;
    }

    // 弃目标1匹马(进攻马优先;若无则防御马)
    const mountId = target.equipment[ownedMounts[0]];
    if (mountId) {
      await applyAtom(ctx.state, { type: '弃置', player: targetIdx, cardIds: [mountId] });
    }
    delete ctx.state.localVars['麒麟弓/confirmed'];
    // 不返回 cancel——伤害正常结算
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '麒麟弓',
    style: 'default',
    prompt: { type: 'confirm', title: '麒麟弓:是否弃目标1匹马?', confirmLabel: '弃马', cancelLabel: '不发动' },
  });
}
