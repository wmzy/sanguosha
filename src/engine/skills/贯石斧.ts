// 贯石斧(武器,攻击范围 3):
//   目标角色使用【闪】后,你可以弃置 2 张牌(手牌或装备区),令此【杀】依然造成伤害。
//
// 一步流程(respond action):
//   1. 询问闪 after hook:目标出闪 → 直接弹选牌面板让玩家选 2 张牌弃置(requestType=贯石斧/select)
//   2. 弃完后把处理区的闪移到弃牌堆,杀.execute 检测处理区无闪 → 自行造成伤害
//   不选/超时 → 贯石斧不发动(杀正常被闪抵消)
import type { FrontendAPI, Skill, GameState } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction } from '../core/skill';
import { setFrameCancelled } from '../core/frame';
import { requireRequestType, registerOnOwnSlashDodged } from '../util/skillRuntime';

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
      const check = requireRequestType(state, ownerId, ['贯石斧/select'], {
        mismatchError: '当前不是贯石斧询问',
      });
      if (check.error) return check.error;
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

  registerOnOwnSlashDodged(
    state,
    skill.id,
    ownerId,
    async (ctx) => {
      const self = ctx.state.players[ownerId];
      if (!self) return;

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
      await setFrameCancelled(ctx.state, ctx.frame, false);
    },
    { weaponName: '贯石斧' },
  );

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
