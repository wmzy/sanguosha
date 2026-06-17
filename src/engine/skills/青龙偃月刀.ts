// 青龙偃月刀(武器,攻击范围 3):
//   你使用的【杀】被【闪】抵消后,你可以对相同目标再使用 1 张杀。
//   可以连续追击直到命中或无杀可用。
import type { AtomAfterContext, FrontendAPI, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '青龙偃月刀',
    description: '武器技:杀被闪抵消后,可对相同目标再使用一张杀',
  };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'respond',
    (state, params) => {
      if (state.pendingSlots.get(ownerId)?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (state.pendingSlots.get(ownerId)!.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '青龙偃月刀/confirm') return '当前不是青龙偃月刀确认';
      return null;
    },
    async (state, params) => {
      state.localVars['青龙偃月刀/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  registerAfterHook(_skill.id, ownerId, '询问闪', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number };
    if (atom.source !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const weaponId = self.equipment?.['武器'];
    if (!weaponId) return;
    const weapon = ctx.state.cardMap[weaponId];
    if (!weapon || weapon.name !== '青龙偃月刀') return;

    // 检查处理区是否有闪(目标出了闪)
    const dodgeCardId = ctx.state.zones.processing.find(id => {
      const c = ctx.state.cardMap[id];
      return c && c.name === '闪';
    });
    if (!dodgeCardId) return; // 没出闪,不需要追杀

    // 询问是否追杀
    delete ctx.state.localVars['青龙偃月刀/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '青龙偃月刀/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '青龙偃月刀:是否追杀?', confirmLabel: '追杀', cancelLabel: '不追杀' },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars['青龙偃月刀/confirmed']) return;
    delete ctx.state.localVars['青龙偃月刀/confirmed'];

    // 追杀:先把刚才的闪移出处理区(杀的结算流程会检查,但这里我们已经接管了)
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: dodgeCardId,
      from: { zone: '处理区' },
      to: { zone: '弃牌堆' },
    });

    // 再次询问闪
    await applyAtom(ctx.state, { type: '询问闪', target: atom.target!, source: ownerId });

    // 检查处理区:有闪 = 出了闪;没有 = 伤害
    const dodge2CardId = ctx.state.zones.processing.find(id => {
      const c = ctx.state.cardMap[id];
      return c && c.name === '闪';
    });
    if (dodge2CardId) {
      await applyAtom(ctx.state, {
        type: '移动牌',
        cardId: dodge2CardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    } else {
      await applyAtom(ctx.state, { type: '造成伤害', target: atom.target!, amount: 1, source: ownerId });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '青龙偃月刀',
    style: 'danger',
    prompt: { type: 'confirm', title: '青龙偃月刀：是否追杀？', confirmLabel: '追杀', cancelLabel: '不追杀' },
  });
}

