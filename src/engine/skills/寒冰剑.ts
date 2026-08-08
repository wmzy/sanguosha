// 寒冰剑(武器,攻击范围 2):
//   每当你使用【杀】对目标角色造成伤害时,若其有牌(手牌或装备区),你可以防止此伤害,
//   改为依次弃置其两张牌(手牌或装备区,由你逐张选择)。
import type { FrontendAPI, HookResult, Skill, GameState } from '../types';
import { applyAtom } from '../index';
import { registerAction, registerBeforeHook } from '../core/skill';
import { runPickTargetCardPanel } from '../flows/pick-card-panel';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '寒冰剑', description: '武器:杀造成伤害时可改为依次弃目标2张牌', isLocked: true };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // respond:被询问时回应。按 requestType 分两步:
  //   '寒冰剑/confirm' → 设 localVars 标记是否发动
  //   '寒冰剑/选牌'    → 设 localVars['选牌/结果'](由 选牌面板.ts 读取)
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (slot.atom as { requestType?: string }).requestType;
      if (requestType === '寒冰剑/confirm') {
        return null;
      }
      if (requestType === '寒冰剑/选牌') {
        const zone = params.zone;
        if (zone === 'equipment') {
          if (typeof params.cardId !== 'string') return 'cardId required';
        } else if (zone === 'hand') {
          if (typeof params.handIndex !== 'number') return 'handIndex required';
        } else {
          return 'zone required (equipment|hand)';
        }
        return null;
      }
      return '当前不是寒冰剑回应';
    },
    async (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      const requestType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (requestType === '寒冰剑/confirm') {
        state.localVars['寒冰剑/confirmed'] = params.choice === true || params.confirmed === true;
      } else if (requestType === '寒冰剑/选牌') {
        state.localVars['选牌/结果'] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
      }
    },
  );

  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '受到伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self) return;
      const weaponId = self.equipment['武器'];
      if (!weaponId) return;
      const weapon = ctx.state.cardMap[weaponId];
      if (weapon?.name !== '寒冰剑') return;
      // 仅限【杀】造成的伤害才触发(普通/火/雷杀 name 均为 '杀')。
      // 决斗/南蛮入侵/万箭齐发/火攻 等其他来源的伤害不触发(规则:仅你使用【杀】造成伤害时)。
      const damageCardId = atom.cardId;
      if (!damageCardId) return;
      const damageCard = ctx.state.cardMap[damageCardId];
      if (damageCard?.name !== '杀') return;
      const target = ctx.state.players[atom.target];
      if (!target) return;
      // 触发条件:目标有牌(手牌或装备区)
      const hasCards = target.hand.length > 0 || Object.keys(target.equipment).length > 0;
      if (!hasCards) return;

      // 询问是否发动
      delete ctx.state.localVars['寒冰剑/confirmed'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: '寒冰剑/confirm',
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '寒冰剑:是否改为弃目标2张牌?',
          confirmLabel: '弃牌',
          cancelLabel: '正常伤害',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (!ctx.state.localVars['寒冰剑/confirmed']) return;

      // 依次弃目标最多2张牌(手牌或装备区,寒冰剑使用者逐张选择;不含判定区)
      for (let i = 0; i < 2; i++) {
        const tp = ctx.state.players[atom.target];
        if (!tp) break;
        const stillHas = tp.hand.length > 0 || Object.keys(tp.equipment).length > 0;
        if (!stillHas) break;
        await runPickTargetCardPanel(ctx.state, ownerId, atom.target, tp, {
          mode: 'discard',
          requestType: '寒冰剑/选牌',
          title: `寒冰剑:选择弃置目标的牌(第${i + 1}张)`,
          includeJudge: false,
        });
      }
      delete ctx.state.localVars['寒冰剑/confirmed'];
      return { kind: 'cancel' };
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '寒冰剑',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '寒冰剑：是否改为弃目标2张？',
      confirmLabel: '弃牌',
      cancelLabel: '正常伤害',
    },
  });
}
