// 贯石斧(武器,攻击范围 3):
//   目标角色使用【闪】后,你可以弃置 2 张牌(手牌或装备区),令此【杀】依然造成伤害。
//
// 一步流程(respond action):
//   1. 询问闪 after hook:目标出闪 → 直接弹选牌面板让玩家选 2 张牌弃置(requestType=贯石斧/select)
//   2. 弃完后把处理区的闪移到弃牌堆,杀.execute 检测处理区无闪 → 自行造成伤害
//   不选/超时 → 贯石斧不发动(杀正常被闪抵消)
import type { FrontendAPI, Skill, GameState } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import { isCancelled, clearCancelled } from '../core/card-effect/registry';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '贯石斧',
    description: '武器技:杀被闪抵消后,可弃两张牌令此杀依然造成伤害',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // respond action:玩家选 2 张牌弃置(不选/超时 → 不发动)
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (slot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '贯石斧/select') {
        return '当前不是贯石斧询问';
      }
      const cardIds = params.cardIds;
      if (!Array.isArray(cardIds) || cardIds.length !== 2) return '需要选择 2 张牌';
      const self = state.players[ownerId];
      if (!self) return 'player not found';
      const [id1, id2] = cardIds as string[];
      if (id1 === id2) return '不能选择同一张牌';
      const equipIds = Object.values(self.equipment).filter(
        (id): id is string => typeof id === 'string',
      );
      const allOwn = [id1, id2].every((id) => self.hand.includes(id) || equipIds.includes(id));
      if (!allOwn) return '所选牌不在你的手牌或装备区';
      return null;
    },
    async (state, params) => {
      state.localVars['贯石斧/selected'] = params.cardIds;
    },
  );

  registerAfterHook(state, skill.id, ownerId, '被抵消', async (ctx) => {
    // 只对杀生效:万箭齐发等锦囊被闪抵消不触发武器技(规则:贯石斧是"你使用的杀被抵消")
    if (ctx.frame.skillId !== '杀') return;
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const weaponId = self.equipment['武器'];
    if (!weaponId) return;
    const weapon = ctx.state.cardMap[weaponId];
    if (weapon?.name !== '贯石斧') return;

    // 检查是否被抵消（闪已设置标记,但闪已被 drain 到弃牌堆）
    if (!isCancelled(ctx.state, atom.cardId, atom.target)) return;

    // 可弃牌数不足 2 张时无法强命(手牌 + 装备区)
    const equipIds = Object.values(self.equipment).filter(
      (id): id is string => typeof id === 'string',
    );
    const availableCount = self.hand.length + equipIds.length;
    if (availableCount < 2) return;

    // 直接弹选牌面板:玩家选 2 张牌弃置(不选/超时 → 不发动)
    delete ctx.state.localVars['贯石斧/selected'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '贯石斧/select',
      target: ownerId,
      prompt: {
        type: 'distribute',
        title: '贯石斧:选择 2 张牌弃置强命(不选则不发动)',
        mode: 'select',
        source: 'handAndEquip',
        minTotal: 2,
        maxTotal: 2,
      },
      defaultChoice: false,
      timeout: 30,
    });
    const selectedIds = ctx.state.localVars['贯石斧/selected'] as string[] | undefined;
    delete ctx.state.localVars['贯石斧/selected'];
    if (selectedIds?.length !== 2) return;

    // 弃置选中的 2 张牌(手牌+装备区均可,用弃置 atom 统一处理)
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: selectedIds, voluntary: true });

    // 清除已抵消标记:杀不再被抵消,将正常造成伤害(runSettlementPhase 检测标记被清除后继续 resolve)
    clearCancelled(ctx.state, atom.cardId, atom.target);
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '贯石斧',
    style: 'danger',
    prompt: {
      type: 'distribute',
      title: '贯石斧:选择 2 张牌弃置强命(不选则不发动)',
      mode: 'select',
      source: 'handAndEquip',
      minTotal: 2,
      maxTotal: 2,
    },
  });
}
