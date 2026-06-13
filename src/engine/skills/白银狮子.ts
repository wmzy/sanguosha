// src/engine/skills/白银狮子.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   白银狮子(防具):锁定技,
//     1) 每次受到【杀】造成的伤害最多为 1 点(非杀的伤害不削)。
//     2) 装备时,你回复 1 点体力。
//
// 关键原子操作:
//   before 钩子(造成伤害):
//     若 atom.target===ownerId ∧ amount>1 ∧ 装备的是白银狮子 →
//     dropAtom → applyAtom(amount=1, ...)
//
// 关键时机:
//   - 造成伤害 atom apply 之前 drop,再 apply 削到 1
//
// 已知问题/不完整实现:
//   1. **未实现"装备时回复 1 点体力"**:这是白银狮子的关键效果之一!
//      onInit 只注册了 hook,没有"装备时(瞬时) 回复 1 点体力"的逻辑——
//      玩家装备白银狮子后**不会立即回血**,违反规则。
//      应该在 createEngine/instantiateSkill 时由装备通用.ts 触发
//      (装备时调 applyAtom 回复),或在 onInit 内立即 applyAtom 摸血。
//   2. **未限"杀"**:当前对任何 atom.target===ownerId ∧ amount>1 的伤害
//      都削到 1,违反规则——非杀伤害(火攻/雷击/决斗等)不应被削。
//      需检查 atom.cardId 指向的 card.name === '杀'。
//      (藤甲也是同样问题,这两个防具应共享 cardId==='杀' 校验逻辑。)
//   3. **防具名硬编码 '白银狮子'**:用 ctx.state.cardMap 查名,但 hook 自身没有
//      "若装备换走"时主动 unregister 的机制——依赖装备通用.ts 的 unloadSkillInstance
//      正确触发 unregisterHook(需 cross-check)。
//      更稳健做法:hook 内部直接 self-check 当前装备,而不是依赖"hook 还存在
//      意味着白银狮子还在装备"——目前是这样做,但也意味着 hook 在
//      防具换走后没卸载,只是 early return,可能造成微小性能浪费。
//   4. **re-apply 的伤害会再触发本 hook**:新 amount=1,本 hook `if amount<=1 return;`
//      early return——OK,自动终止(无 guard mark,但隐式终止)。
//      但若目标同时有藤甲,藤甲可能再触发 re-apply(1-1=0 或 1+1=2),藤甲的
//      re-apply 又会再回到白银狮子——多防具叠加时的链式触发未约束。
//   5. **drop+re-apply 反模式**:同藤甲。
//   6. **没有"防止多于 1 点的伤害"的回血触发**:规则上白银狮子是"锁定削伤",
//      不是"溢伤转回血"——削到 1 点已经是规则最大,不要再回血。当前实现正确。
// ============================================================
import type { AtomAfterContext, AtomBeforeContext, Skill } from '../types';
import { applyAtom, dropAtom } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '白银狮子', description: '防具:每次受伤最多1点' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  // 受到伤害时:如果 amount > 1,替换为 amount = 1
  // 实现:通过标记让造成伤害后判断(简化:用 before 钩子 drop 原始伤害并 apply 修正后的)
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { target?: string; amount?: number; source?: string; cardId?: string };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 1) return;
    // 检查是否装备了白银狮子
    const me = ctx.state.players.find(p => p.name === ownerId);
    const armorId = me?.equipment?.['防具'];
    if (!armorId) return;
    const card = ctx.state.cardMap[armorId];
    if (card?.name !== '白银狮子') return;
    // drop 原始伤害,apply 修正后的(最多1点)
    dropAtom(ctx.state);
    await applyAtom(ctx.state, { type: '造成伤害', target: atom.target!, amount: 1, source: atom.source ?? '', cardId: atom.cardId });
  });
  return () => {};
}

export default { createSkill, onInit };
