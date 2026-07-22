// 界绝情(界张春华·锁定技,OL hero/625 官方逐字):
//   "锁定技,你即将造成的伤害视为失去体力。"
//
// 与标版 张春华·绝情 描述一致,但标版未实现,故仍独立创建界版文件。
//
// 实现:before-hook 挂「造成伤害」。
//   - 触发条件:atom.source === ownerId(春华是伤害来源)
//   - 效果:return { kind: 'modify', atom: { type: '失去体力', target, amount } }
//   - modify 语义:管线用新 atom(失去体力)重新走 validate/apply/after hooks,
//     造成伤害 的 after hooks(反馈/奸雄/防具穿透等)不再触发——这正是"视为失去体力"
//     的语义(不触发伤害来源技)。失去体力 的 after hooks 照常触发(系统规则濒死检查等)。
//
// 关键点:
//   - 锁定技,无需询问,无需次数限制。
//   - amount 透传:伤害值 = 失去体力值。
//   -damageType/cardId 等伤害专属字段在失去体力中无意义,自然丢弃。
//   - 系统规则的濒死检查同时挂在 造成伤害 与 失去体力 上,故目标体力归零仍走求桃流程。
import type { FrontendAPI, GameState, HookResult, Skill } from '../types';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '绝情',
    description: '锁定技:你即将造成的伤害视为失去体力',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '造成伤害') return;
      if (atom.source !== ownerId) return;
      if (typeof atom.target !== 'number') return;
      const amount = atom.amount ?? 0;
      if (amount <= 0) return;
      // 将"造成的伤害"改为"失去体力":modify 让管线改走 失去体力 atom
      return {
        kind: 'modify',
        atom: {
          type: '失去体力',
          target: atom.target,
          amount,
        },
      };
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
