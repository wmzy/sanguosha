// src/engine/skills/寒冰剑.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   寒冰剑(武器,攻击范围 2,♠2,EX/1V1/3V3/国-标):
//     - 触发时机:每当你使用【杀】对目标角色造成伤害时
//     - 发动条件:目标有牌
//     - 效果:你可以防止此伤害,改为依次弃置其两张牌
//     - 限制:无次数限制(每张杀触发一次)
//     - 备注:弃置的两张牌可以是手牌或装备区;若不足两张按实际数量弃
//
// 关键原子操作:
//   before 钩子(造成伤害):
//     若 source===ownerId ∧ target 有牌 → 请求回应(confirm 改为弃牌) →
//     若回应: dropAtom(原伤害) + 弃置(target.hand/装备, 最多 2 张)
//
// 关键时机:
//   - 造成伤害 atom apply 之前介入,通过 drop 阻止原伤害并替换为弃牌
//
// 已知问题/不完整实现:
//   (待补充:drop 后的弃牌顺序、是否包含判定区、与防具的交互等)
// ============================================================
import type { AtomBeforeContext, HookResult, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '寒冰剑', description: '武器:杀造成伤害时可改为弃目标2张牌' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
    const atom = ctx.atom as { source?: number; target?: number };
    if (atom.source !== ownerId) return;
    // 检查目标是否有牌可弃
    const target = ctx.state.players[atom.target!];
    if (!target || target.hand.length === 0) return;
    // 询问是否发动
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '寒冰剑/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '寒冰剑:是否改为弃目标2张牌?', confirmLabel: '弃牌', cancelLabel: '正常伤害' },
      defaultChoice: false,
      timeout: 10000,
    });
    const confirmed = ctx.params.__寒冰剑confirmed as boolean | undefined;
    if (!confirmed) return;
    // 弃目标最多2张牌
    const cards = target.hand.slice(0, 2);
    await applyAtom(ctx.state, { type: '弃置', player: atom.target!, cardIds: cards });
    // 改为弃牌 → 取消伤害
    return { kind: 'cancel' };
  });
  return () => {};
}

export default { createSkill, onInit };
