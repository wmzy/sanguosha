// src/engine/skills/青龙偃月刀.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   青龙偃月刀(武器,攻击范围 3,♠5):
//     - 你使用的【杀】被【闪】抵消后
//     - 你可以对相同目标再使用 1 张【杀】
//     - **可以连续追击直到命中或无杀可用**
//
// 关键原子操作:
//   after 钩子(询问闪):
//     若 source===ownerId ∧ dodged → 请求回应(confirm 是否追杀) →
//     若回应 → 询问闪(target, ownerId) [再次询问目标出闪]
//
// 关键时机:
//   - 在询问闪 atom after 触发(目标完成闪回应后)
//   - 通过 ctx.params.__闪避 标记判断目标是否出闪
//
// 已知问题/不完整实现:
//   1. **时机错误**:after of 等待型 atom(询问闪)在 atom apply 之后立即触发,
//      apply 是空 — 实际 hook 触发时,玩家的"出闪/不出闪"回应可能还没到。
//      __闪避 标记在 hook 执行时通常是 undefined,导致追杀永远不触发。
//      正确应该在"杀的 settlement 处理"after,或扩展协议让"等待型 atom 的 after"
//      在 pending resolve 后再触发。
//   2. **不完整的"再次出杀"**:仅再次 询问闪,没走完整的杀流程
//      (无指定目标、无造成伤害、无 settlement 修改)——
//      即使触发也只是"再问一次闪",目标出/不出闪都无后续伤害!
//      应该重新触发"杀"的 use(或部分流程):指定目标 → 询问闪 → 造成伤害。
//   3. **未限于"杀"**:任何 source===self 的"询问闪"都触发,
//      但目前只有杀.ts 派发 询问闪 atom,实际差别不大,但若将来扩展其他卡牌引发询问闪会误触发。
//   4. **未限制每张杀只能追杀一次**:若递归追杀,会无限循环。
//   5. __闪避 / __青龙confirmed 用 __ 私有字段(同反模式)。
// ============================================================
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '青龙偃月刀', description: '武器:目标出闪后可追杀' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAfterHook(_skill.id, ownerId, '询问闪', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== ownerId) return;
    // 目标出了闪才能追杀
    const dodged = ctx.params.__闪避 as boolean | undefined;
    if (!dodged) return;
    // 询问是否追杀
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '青龙偃月刀/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '青龙偃月刀:目标出闪,是否追杀?', confirmLabel: '追杀', cancelLabel: '放弃' },
      defaultChoice: false,
      timeout: 10000,
    });
    const confirmed = ctx.params.__青龙confirmed as boolean | undefined;
    if (!confirmed) return;
    // 再询问一次闪
    await applyAtom(ctx.state, { type: '询问闪', target: atom.target!, source: ownerId });
  });
  return () => {};
}

export default { createSkill, onInit };
