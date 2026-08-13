// 界绝情(界张春华·锁定技,OL hero/625 官方逐字):
//   "锁定技,你即将造成的伤害视为失去体力。"
//
// 与标版 张春华·绝情 描述一致,但标版未实现,故仍独立创建界版文件。
//
// 实现:before-hook 挂「伤害结算开始时」(伤害流程第 1 时机,引擎专为绝情设计的 cancel 点)。
//   - 触发条件:atom.source === ownerId(春华是伤害来源)
//   - 效果:applyAtom(失去体力, target, amount) 后 return { kind: 'cancel' }
//   - cancel 跳过整个伤害流程(时机2~8 不再触发),故 造成伤害后/受到伤害后 等
//     after hooks(反馈/奸雄/狂骨/防具穿透)均不触发——这正是"视为失去体力"的语义
//     (不触发伤害来源技)。失去体力 自身走完整 pipeline,其 after hooks(系统规则濒死
//     检查)照常触发,目标体力归零仍走求桃流程。
//   - 注意:不能用 modify 把 atom 改为 失去体力——modify 只替换当前 atom 并继续同一
//     pipeline,不会 cancel 外层 runDamageFlow,会导致目标先失体力再受伤害(双重结算)。
//
// 关键点:
//   - 锁定技,无需询问,无需次数限制。
//   - amount 透传:伤害值 = 失去体力值。
//   -damageType/cardId 等伤害专属字段在失去体力中无意义,自然丢弃。
//   - 系统规则的濒死检查同时挂在 造成伤害 与 失去体力 上,故目标体力归零仍走求桃流程。
import type { FrontendAPI, GameState, HookResult, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerBeforeHook } from '../core/skill';
import type { SkillModule } from '../types';

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
    '伤害结算开始时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      if (typeof atom.target !== 'number') return;
      const amount = atom.amount ?? 0;
      if (amount <= 0) return;
      // 将「造成的伤害」改为「失去体力」:直接 applyAtom 失去体力,然后 cancel 本次伤害流程
      await applyAtom(ctx.state, { type: '失去体力', target: atom.target, amount });
      return { kind: 'cancel' };
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
