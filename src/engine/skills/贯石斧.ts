// 贯石斧(武器,攻击范围 3):
//   目标角色使用【闪】后,你可以弃置 2 张牌,令此【杀】依然造成伤害。
import type { AtomAfterContext, FrontendAPI, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '贯石斧',
    description: '武器技:杀被闪抵消后,可弃两张手牌令此杀依然造成伤害',
  };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'respond',
    (state, params) => {
      if (state.pendingSlots.get(ownerId)?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (state.pendingSlots.get(ownerId)!.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '贯石斧/confirm') return '当前不是贯石斧确认';
      return null;
    },
    async (state, params) => {
      state.localVars['贯石斧/confirmed'] = params.choice === true || params.confirmed === true;
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
    if (!weapon || weapon.name !== '贯石斧') return;

    // 检查处理区是否有闪(目标出了闪)
    const dodgeCardId = ctx.state.zones.processing.find(id => {
      const c = ctx.state.cardMap[id];
      return c && c.name === '闪';
    });
    if (!dodgeCardId) return; // 没出闪,不需要强命

    // 手牌不足2张时无法强命
    if (self.hand.length < 2) return;

    // 询问是否强命
    delete ctx.state.localVars['贯石斧/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '贯石斧/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '贯石斧:是否弃2张牌强命?', confirmLabel: '强命', cancelLabel: '不发动' },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars['贯石斧/confirmed']) return;
    delete ctx.state.localVars['贯石斧/confirmed'];

    // 弃 2 张手牌 + 把闪移出处理区。不直接造成伤害——杀.execute 发现
    // 处理区无闪后自行结算伤害,避免 after hook 和 execute 双重扣血。
    const discardCards = self.hand.slice(0, 2);
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: discardCards });
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: dodgeCardId,
      from: { zone: '处理区' },
      to: { zone: '弃牌堆' },
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '贯石斧',
    style: 'danger',
    prompt: { type: 'confirm', title: '贯石斧：是否弃2张牌强命？', confirmLabel: '强命', cancelLabel: '不发动' },
  });
}

