// src/engine/skills/青釭剑.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   青釭剑(武器,射程 2):锁定技,当你使用【杀】对其他角色造成伤害时,
//   此伤害无视目标的防具(藤甲/仁王盾/八卦阵等)。
//
// 关键原子操作(标准设计):
//   before 钩子(造成伤害):
//     若 source===ownerId ∧ cardId 为【杀】 → 设置 "无视防具" 标签/标记,
//     使防具的 before hook(藤甲/仁王盾等)跳过减伤逻辑
//
// 已知问题/不完整实现:
//   1. **完全未实现!**:onInit 注册的 hook 内只有第 14 行的空语句 `;`,
//      根本没有任何"无视防具"逻辑——青釭剑装备后完全无效。
//   2. **设计需协议**:无视防具的实现方式应该是在 造成伤害 atom 中加一个 flag
//      (如 atom.ignoreArmor=true),或在 state 上设置短期标签让防具 hook 自查;
//      当前 atom 类型(types.ts)没有这种字段,需扩展。
//   3. **未限于"杀"**:即使将来实现,也需限制只对杀的伤害生效——
//      决斗等也是 source==ownerId 的伤害,但规则上不无视防具。
//   4. **缺少 atom.cardId 携带**:杀.ts 派发 造成伤害 atom 时未带 cardId(只带 source/target/amount),
//      青釭剑无法判断"伤害来源是否是杀牌"。
// ============================================================
import type { AtomBeforeContext, Skill } from '../types';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '青釭剑', description: '武器:杀无视目标防具' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== ownerId) return;
    ;
  });
  return () => {};
}

export default { createSkill, onInit };
