// src/engine/skills/藤甲.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   藤甲(防具):锁定技,【杀】对你造成的伤害 -1(最少 0 点);
//   火焰伤害(【火杀】/【火攻】/南蛮入侵/万箭齐发/火属性伤害)+1。
//
// 关键原子操作:
//   before 钩子(造成伤害):
//     若 atom.target===ownerId:
//       baseAmount = atom.amount
//       fire ? newAmount = baseAmount + 1 : newAmount = max(0, baseAmount - 1)
//       dropAtom(原伤害) → 加 mark('藤甲/applied', scope=-1) → applyAtom(调整后伤害)
//
// 关键时机:
//   - 在 造成伤害 atom apply 之前,drop+re-apply 模式
//   - guard mark('藤甲/applied')防止 re-entry 时无限循环
//
// 已知问题/不完整实现:
//   1. **致命:guard mark scope=-1(永久)**:装备藤甲后受一次伤害 → mark 永久加
//      → 后续所有伤害(无论杀还是属性伤害)都跳过藤甲调整!
//      mark 应该是 per-damage-instance 临时,而不是永久加。
//      正确做法:不在 state 上加永久 mark,而是检查 ctx 上是否有 reentry 标志
//      (如 atom.__reentry 或 ctx.params.__藤甲reentry),或者在 drop+re-apply 时
//      重新 dispatch 一个全新的 atom 上下文(走 create-engine 的新一帧)。
//   2. **未限"杀"**:规则上 -1 仅对【杀】生效,属性伤害(雷击/火攻/酒诗等)不减伤。
//      当前 hook 对任何 atom.target===ownerId 的伤害都减 1,违反规则。
//      需检查 atom.cardId 指向的 card.name === '杀'。
//   3. **fire+1 是火焰伤害+1**:但 damageType==='fire' 包括属性伤害(火攻/雷击/南蛮),
//      规则上藤甲对【火杀】、【火攻】、南蛮入侵、万箭齐发等 +1,但**不对雷击/闪电等
//      非火焰伤害 +1**——需检查 damageType 来源是"火属性"。
//      雷击的 damageType 可能是 'thunder' 而不是 'fire',需 cross-check。
//   4. **drop+re-apply 反模式**:同酒/白银狮子/寒冰剑,易引入多防具叠加时 race condition。
//      三种防具(藤甲/仁王盾/白银狮子)同时装备时,drop 顺序与 re-apply 顺序未保证。
//      应改为"在 atom apply 阶段直接 mutate atom.amount,不要 drop+re-apply"。
//   5. **新 amount=0 时 drop+不再 apply**:正确(若伤害已为 0,藤甲后无需再造成伤害),
//      但前端 UI 可能没收到"伤害被防具免疫"事件。
//   6. **新增 max(0) 边界**:伤害不会被削到负数,但 baseAmount=0 时 max(0, 0-1) 仍为 0
//      → newAmount === baseAmount → 提前 return,藤甲不触发——OK 但属于隐式正确。
// ============================================================
import type { AtomBeforeContext, Skill } from '../types';
import { applyAtom, dropAtom } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '藤甲', description: '防具:普通杀伤害-1,火焰伤害+1' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { target?: string; amount?: number; damageType?: string };
    if (atom.target !== ownerId) return;
    // 防 re-entry:drop 后重新 apply 时不再处理
    const self = ctx.state.players.find((p) => p.name === ownerId);
    if (!self) return;
    if (self.marks.some((m) => m.id === '藤甲/applied')) return;

    const baseAmount = atom.amount ?? 1;
    let newAmount: number;
    if (atom.damageType === 'fire') {
      newAmount = baseAmount + 1;
    } else {
      newAmount = Math.max(0, baseAmount - 1);
    }
    if (newAmount === baseAmount) return; // 无变化

    dropAtom(ctx.state);
    // 加 guard mark 防止 re-entry
    await applyAtom(ctx.state, {
      type: '加标记',
      player: ownerId,
      mark: { id: '藤甲/applied', scope: -1 },
    });
    // 重新 apply 调整后的伤害
    if (newAmount > 0) {
      await applyAtom(ctx.state, { ...ctx.atom, amount: newAmount } as typeof ctx.atom);
    }
  });
  return () => {};
}

export default { createSkill, onInit };
