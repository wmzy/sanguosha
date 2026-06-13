// src/engine/skills/贯石斧.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   贯石斧(武器,射程 3):当你使用【杀】被【闪】抵消后,你可以弃置 2 张牌,
//   令此【杀】依然造成伤害(强命)。弃置的 2 张牌可以来自手牌或装备区。
//
// 关键原子操作:
//   after 钩子(询问闪):
//     若 source===ownerId ∧ dodged ∧ self.hand.length>=2 → 请求回应(confirm) →
//     若回应 → 弃置(self.hand[0..2]) → mutate settlement[i].dodged=false
//
// 关键时机:
//   - 询问闪 完成后,在杀的"造成伤害"环节之前(mutate settlement[].dodged 让后续 for-loop 重读)
//
// 已知问题/不完整实现:
//   1. **__闪避 标记时机错**(同青龙偃月刀):ctx.params.__闪避 在 询问闪 after hook 执行时
//      通常未设——闪.ts 是通过 mutate frame.params.settlement[].dodged 来标记,
//      不写 __闪避 字段。本文件应读 settlement.find(s=>s.target===atom.target).dodged。
//      实际:贯石斧永远不触发(没人写 __闪避)。
//   2. **弃牌固定 hand[0..2]**:玩家无法选弃哪 2 张,影响策略;
//      规则允许从装备区弃牌,当前完全不支持。
//   3. **wpc的 attack target 仅一个**:贯石斧基于"被闪了"触发,
//      若杀有多个目标(连弩+方天画戟+雌雄等),需逐个目标判断"是否被闪",
//      当前实现只看 atom.target 单个目标。
//   4. **未限于"杀"**:任何"询问闪"都触发,但目前只有杀.ts 派发 询问闪 atom,实际差别不大。
//   5. self.hand.length < 2 时 silent skip,不报错——但应给玩家"强命不可用"的反馈。
//   6. __贯石斧confirmed 用 __ 私有字段。
// ============================================================
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '贯石斧', description: '武器:杀被闪后可弃2张牌强命' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAfterHook(_skill.id, ownerId, '询问闪', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== ownerId) return;
    // 检查是否出了闪(通过 params 标记或 parent frame 的 settlement)
    // 简化: 如果有 __闪避 标记说明目标出了闪
    const dodged = ctx.params.__闪避 as boolean | undefined;
    if (!dodged) return; // 没出闪,不需要强命
    // 检查手牌是否>=2
    const self = ctx.state.players.find(p => p.name === ownerId);
    if (!self || self.hand.length < 2) return;
    // 询问是否弃2牌强命
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '贯石斧/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '贯石斧:是否弃2张牌强命?', confirmLabel: '强命', cancelLabel: '放弃' },
      defaultChoice: false,
      timeout: 10000,
    });
    const confirmed = ctx.params.__贯石斧confirmed as boolean | undefined;
    if (!confirmed) return;
    // 弃2张牌(简化:弃手牌前2张)
    const discardCards = self.hand.slice(0, 2);
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: discardCards });
    // 在当前帧标记 dodged=false(强命)
    const settlement = ctx.params.settlement as Array<{ target: string; dodged: boolean }> | undefined;
    if (settlement) {
      const item = settlement.find(s => s.target === atom.target);
      if (item) item.dodged = false;
    }
  });
  return () => {};
}

export default { createSkill, onInit };
