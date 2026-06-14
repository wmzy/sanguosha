// src/engine/skills/方天画戟.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   方天画戟(武器,攻击范围 4,♦Q):
//     - 当你使用【杀】时,若此【杀】是你最后 1 张手牌
//     - 你可以为此【杀】额外指定至多 2 个目标
//     - 即最多可以同时攻击 3 名角色
//
// 关键原子操作(标准设计):
//   方天画戟实质上扩展了杀的"目标数量上限"——
//   应在杀的 validate 中,若装备方天画戟 ∧ 是最后一张手牌 → 允许 targets.length≤3。
//
// 已知问题/不完整实现:
//   1. **完全未实现!**:onInit 注册了 before hook(指定目标),
//      但 hook 内除了 early return 之外只有第 19 行的空语句 `;`,**无任何逻辑**。
//   2. **设计方向错误**:即使将来填充实现,"在指定目标 before hook 介入"是行不通的——
//      杀.ts 的 validate 阶段已经限制了 targets.length(通过 distance 检查每个目标),
//      hook 在 指定目标 atom 执行时才介入已经太晚。
//      正确做法:扩展杀的 validate,在装备方天画戟时放宽 targets 长度限制(允许 max=3)。
//   3. **未联动 UI**:onMount 缺失,前端无法在选择杀目标时让玩家多选(最多 3 个)。
//   4. **"最后一张手牌"判断脆弱**:hook 中检查 self.hand.length===1,
//      但若使用杀本身时杀已从手牌移到处理区,length 可能就是 0,
//      实际应在杀进入处理区"之前"判断,即 use 流程刚开始的状态。
// ============================================================
import type { AtomBeforeContext, Skill } from '../types';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '方天画戟', description: '武器:最后一张手牌为杀时可指定最多3个目标' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  // 在指定目标 before 钩子中标记多目标
  registerBeforeHook(_skill.id, ownerId, '指定目标', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { source?: string };
    if (atom.source !== ownerId) return;
    const self = ctx.state.players.find(p => p.name === ownerId);
    if (!self || self.hand.length !== 1) return; // 不是最后一张
    const lastCard = ctx.state.cardMap[self.hand[0]];
    if (!lastCard || lastCard.name !== '杀') return; // 最后一张不是杀
    ;
  });
  return () => {};
}

export default { createSkill, onInit };
