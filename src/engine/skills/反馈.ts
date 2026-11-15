// 反馈(司马懿·被动技):当你受到伤害后,你可以获得伤害来源的一张牌。
//
// 实现(被动 after-hook + 两步 respond):
//   受到伤害后 after-hook(前导守卫经 registerOnDamagedAsTarget;来源存活):
//     1. 询问是否发动(请求回应 requestType='反馈/confirm',confirm prompt)
//     2. confirm 后弹选牌面板(请求回应 requestType='反馈/选牌',pickTargetCard prompt):
//        使用者从来源区域选一张牌获得(手牌盲选 / 装备明选)。经典规则不含判定区。
//
// 关键点:
//   - 一个技能实例仅能注册一个 respond action(actionKey 冲突),故 confirm 与选牌
//     合并为单 respond 按 requestType 分支(同固政/双雄模式)。
//   - requestType '反馈/选牌' 经 resolvePendingRespond 按 [/_] 分割得 skillId='反馈',
//     前端 pickTargetCard 渲染与无头客户端 availableActions 自动路由(不再硬编码)。
//   - 选牌面板逻辑与过河拆桥/顺手牵羊共用(见 ../pick-card-panel.ts);反馈为 obtain 模式,
//     includeJudge=false(经典规则仅手牌+装备)。
import type { FrontendAPI, Skill } from '../types';
import { registerAction } from '../core/skill';
import { runPickTargetCardPanel } from '../flows/pick-card-panel';
import { PICK_RESULT_KEY } from '../rules/vars-keys';
import { askConfirm, defineConfirmAction, registerOnDamagedAsTarget } from '../util/skillRuntime';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '反馈',
    description: '受到伤害后,你可以获得伤害来源的一张牌',
  };
}

export function onInit(skill: Skill, state: import('../types').GameState): () => void {
  const ownerId = skill.ownerId;
  // respond:被询问时回应。按 requestType 分两步:
  //   '反馈/confirm' → 设 localVars 标记是否发动
  //   '反馈/选牌'    → 设 localVars[PICK_RESULT_KEY](由 选牌面板.ts 读取)
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
      if (requestType === '反馈/confirm') {
        // confirm:接受 choice/confirmed 布尔
        return null;
      }
      if (requestType === '反馈/选牌') {
        // 选牌面板:校验 zone + cardId/handIndex(同过河拆桥/顺手牵羊)
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
      return '当前不是反馈回应';
    },
    async (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      const requestType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (requestType === '反馈/confirm') {
        state.localVars['反馈/confirmed'] =
          params.choice === true || params.confirmed === true;
      } else if (requestType === '反馈/选牌') {
        state.localVars[PICK_RESULT_KEY] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
      }
    },
  );

  // 前导守卫(target===ownerId / amount>0 / 来源存在且非自己)经 registerOnDamagedAsTarget 统一封装
  registerOnDamagedAsTarget(state, skill.id, ownerId, async (ctx) => {
    const atom = ctx.atom;
    const sourcePlayer = ctx.state.players[atom.source];
    if (!sourcePlayer?.alive) return;
    // 反馈(经典):仅手牌+装备,不含判定区
    const hasCards = sourcePlayer.hand.length > 0 || Object.keys(sourcePlayer.equipment).length > 0;
    if (!hasCards) return;

    // 询问是否发动
    const confirmed = await askConfirm(ctx.state, '反馈/confirm', ownerId, {
      confirmedKey: '反馈/confirmed',
      title: '是否发动反馈?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
      defaultChoice: false,
      timeout: 10,
    });
    if (!confirmed) return;

    // 弹选牌面板:从来源区域选一张牌获得(手牌盲选 / 装备明选,不含判定区)
    const source = ctx.state.players[atom.source];
    if (!source) return;
    await runPickTargetCardPanel(ctx.state, ownerId, atom.source, source, {
      mode: 'obtain',
      requestType: '反馈/选牌',
      title: '反馈:选择获得来源的一张牌',
      includeJudge: false,
    });
  });
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  defineConfirmAction(api, 'respond', {
    label: '反馈',
    title: '是否发动反馈？',
    style: 'default',
  });
}
