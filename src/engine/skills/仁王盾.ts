// src/engine/skills/仁王盾.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   仁王盾(防具):锁定技,黑色【杀】对你无效。
//
// 关键原子操作:
//   before 钩子(造成伤害):
//     若 atom.target===ownerId ∧ atom.cardId 的 suit 为黑(♠/♣) → dropAtom(取消伤害)
//
// 关键时机:
//   - 在 造成伤害 atom apply 之前,直接 drop 整次伤害
//
// 已知问题/不完整实现:
//   1. **第 20 行空语句** `;`:无功能,残留未清理。
//   2. **未检查 cardId 是否为【杀】**:这是最严重的 bug!
//      规则上只对"杀"造成的伤害生效。当前 hook 对任何 cardId 都会按 suit 判断:
//      决斗(无 cardId 或有决斗 cardId)/借刀杀人/南蛮入侵/反伤/属性伤害(雷击/火攻)等
//      只要 suit 是黑色,就会被错误拦截!
//      需检查 atom.cardId 对应的 card.name === '杀' 才生效。
//   3. **未区分"使用者是自己"**:规则上"黑色杀对你无效"——仁王盾只对**其他角色**
//      对你使用杀时生效,自己对自己使用杀时仁王盾不应触发。当前 atom.target===ownerId
//      已隐含这个语义(自杀极少),但若 source===target 需跳过——目前没排除。
//   4. **卸下时 hook 是否解绑**:仁王盾 hook 监听 '造成伤害',
//      装备被替换(防具区换装)时装备通用.ts 应通过 unloadSkillInstance 卸载并
//      unregisterHook(装备通用.ts 实现需 cross-check)。
//   5. **与青釭剑/藤甲叠加时优先级未定义**:青釭剑"无视防具"尚未实现,
//      一旦实现,应在 hook 顺序中排在仁王盾/藤甲之前——目前未约束。
// ============================================================
import type { AtomBeforeContext, Skill } from '../types';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '仁王盾', description: '防具:黑色杀对你无效' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<{ kind: 'cancel' } | void> => {
    const atom = ctx.atom as { target?: number; source?: number; cardId?: string };
    if (atom.target !== ownerId) return;
    // 检查杀的颜色
    if (!atom.cardId) return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!card) return;
    if (card.suit === '♠' || card.suit === '♣') {
      return { kind: 'cancel' }; // 黑色杀无效
    }
  });
  return () => {};
}

export default { createSkill, onInit };
