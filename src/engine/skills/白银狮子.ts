// src/engine/skills/白银狮子.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md / 基础规则.md):
//   白银狮子(防具,军争篇新增):锁定技,
//     1) 当你受到伤害时,此伤害值最多为 1(对所有伤害生效,**不限【杀】**)。
//     2) 当你失去装备区里的【白银狮子】时,你回复 1 点体力
//        (被替换/拆掉/顺走/被弃置等任何"失去"路径都触发)。
//
// 关键原子操作:
//   before 钩子(造成伤害):
//     若 atom.target===ownerId ∧ amount>1 ∧ 装备的是白银狮子 →
//     dropAtom → applyAtom(amount=1, ...)
//   失去时回血(尚未实现):
//     装备通用.ts 在"装备替换/被拆除/被顺走"等卸下路径触发后,
//     应 applyAtom(回复体力, ownerId, 1)。
//
// 关键时机:
//   - 造成伤害 atom apply 之前 drop,再 apply 削到 1
//   - 失去装备区白银狮子的时机(被替换/拆/顺/弃)
//
// 已知问题/不完整实现:
//   1. **未实现"失去时回复 1 点体力"**:这是白银狮子的关键效果之一!
//      玩家装备白银狮子后,任何导致白银狮子离开装备区的事件
//      (被换装/过河拆桥/顺手牵羊/弃置……)都应回 1 血——当前**完全缺失**。
//      应在装备通用.ts 的"卸下"路径(无论是换装/被拆/被顺)后
//      同步 applyAtom 回复体力 1 点,或在此处 onInit 注册 after hook(卸下) 触发。
//   2. **装备时"不"回血**:与某些"防具如 +1 马"规则混淆——白银狮子**不是装备时**回血,
//      而是**失去时**回血。装备白银狮子本身不立即产生回血。
//   3. **drop+re-apply 反模式**:同藤甲。多防具叠加时
//      (白银狮子+藤甲)链式触发未约束。
//   4. **防具名硬编码 '白银狮子'**:用 ctx.state.cardMap 查名,
//      hook 自身依赖"装备换走后 hook 还在,只是 early return"的隐式正确。
//      更稳健做法:依赖装备通用.ts 的 unloadSkillInstance 正确 unregisterHook。
// ============================================================
import type { AtomBeforeContext, Skill } from '../types';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '白银狮子', description: '防具:每次受伤最多1点' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<{ kind: 'modify' } | void> => {
    const atom = ctx.atom as { target?: number; amount?: number; source?: number; cardId?: string };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 1) return;
    // 检查是否装备了白银狮子
    const me = ctx.state.players[ownerId];
    const armorId = me?.equipment?.['防具'];
    if (!armorId) return;
    const card = ctx.state.cardMap[armorId];
    if (card?.name !== '白银狮子') return;
    // 伤害上限 1
    return { kind: 'modify', atom: { ...ctx.atom, amount: 1 } as typeof ctx.atom };
  });
  return () => {};
}

export default { createSkill, onInit };