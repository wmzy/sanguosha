// src/engine/skills/护甲.ts
// ============================================================
// 技能描述(项目自定义技能,非三国杀标准武将技):
//   护甲(锁定技):当你受到【杀】造成的伤害时,若此【杀】为黑色,伤害 -1。
//   功能上对应仁王盾防具,但作为武将技实现。
//
// 关键原子操作:
//   before 钩子(造成伤害):
//     若 target===self ∧ cardId 是黑色【杀】 ∧ 无 guard mark
//       → dropAtom + 加 guard mark + (若 amount>1) applyAtom(amount-1)
//
// 关键时机:
//   - 在 造成伤害 atom 执行前介入,通过 drop+re-apply 减少 amount
//   - guard mark '护甲/applied' 防止 re-apply 后的 atom 再次被本 hook 拦截
//
// 已知问题/不完整实现:
//   1. **guard mark 永久残留**:加了 '护甲/applied' 后没有任何清理时机——
//      回合不清,场次不清。这导致护甲只能在整局游戏中触发一次!
//      正确应该是 duration='turn' 或在本次 damage 处理完后立即去除。
//      验证:测试中若同一玩家多次受到黑色杀,第二次将不触发减伤(bug)。
//   2. **杀名匹配过宽**:`card.name.includes('杀')` 会误匹配未来可能存在的"火杀"/"雷杀"
//      (虽然目前应是 '杀'),但更稳健的写法是 card.name === '杀'。
//      ——不过若是"火杀/雷杀"也应触发护甲(规则上仍是杀),实际是判断"是否为【杀】牌",
//      需要按"基础牌类型"判断,而非 name 字符串。
//   3. **drop+re-apply 反模式**(同酒.ts):破坏 before hook 链顺序,
//      其他 hook(如酒+1)与本 hook 共存时,执行顺序敏感。
//   4. amount=1 时直接 drop 不 re-apply——但不发出 "完全免疫" 事件,前端 UI 可能无感知。
//   5. **重复实现**:仁王盾(防具)有完全相同的逻辑,二者无复用关系——
//      应通过共享 hook 工具或 atom 修正管道避免重复。
// ============================================================
import type { Atom, AtomBeforeContext, HookResult, Skill } from '../types';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '护甲',
    description: '锁定技:受到【杀】造成的伤害时,若此牌为黑色,伤害 -1',
  };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
    const atom = ctx.atom as { target?: number; cardId?: string; amount?: number; type: string };
    if (atom.target !== ownerId) return;
    if (typeof atom.cardId !== 'string') return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!card) return;
    if (!card.name.includes('杀')) return;  // 非杀牌不触发
    if (card.suit !== '♠' && card.suit !== '♣') return;  // 仅黑色
    const baseAmount = atom.amount ?? 0;
    if (baseAmount <= 0) return;
    // 黑色杀伤害 -1
    return { kind: 'modify', atom: { ...ctx.atom, amount: baseAmount - 1 } as typeof ctx.atom };
  });
  return () => {};
}

export default { createSkill, onInit };