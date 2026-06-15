// src/engine/skills/青釭剑.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   青釭剑(武器,攻击范围 2,♠6):
//     - 锁定技
//     - 你使用的【杀】无视目标防具
//     - 即使目标装备八卦阵、仁王盾等防具也无效
//
// 关键原子操作:
//   before 钩子(造成伤害):
//     若 atom.source === 青釭剑持有者(本 ownerId)
//     ∧ 持有者当前装备的武器牌 name === '青釭剑'(动态校核:可能中途换下)
//     ∧ atom.cardId 对应的牌 name includes '杀'(限于"杀"造成的伤害——决斗等不无视)
//     → 给目标加标签 '青釭剑/无视防具'
//
//   防具钩子契约(由 藤甲/仁王盾/护甲 等实现):
//     before 钩子(造成伤害)处理前检查目标 marks 是否含 'tag:青釭剑/无视防具',
//     有则 pass(防具效果对该次杀无效)。
//     hook 注册顺序必须使青釭剑的 before 钩子排在防具钩子之前,
//     才能在防具介入前先把 tag 写入 state(目前依赖 添加技能 atom 的派发顺序)。
//
// 关键时机:
//   - 装备青釭剑:由装备通用.ts 派发 装备 atom;技能实例化由 添加技能 atom 触发
//     (本文件不处理装备/技能挂载,仅在被 instantiate 后注册 before 钩子)
//   - 换装/失去:unloadSkillInstance 由 移除技能 atom 触发,本 hook 自动解绑
//
// 已知问题/不完整实现:
//   1. **hook 顺序未硬保证**:若目标先装备 藤甲/仁王盾(技能注册早),再装备青釭剑
//     (本钩子注册晚),则 造成伤害 atom 的 before 链中防具钩子先跑——防具已生效,
//     本钩子再写 tag 已无意义。需要项目层面统一 hook 优先级或拆成两段流水线。
//   2. **未注册 卸下 即时清理 tag**:若某玩家在本回合之前被加了
//     '青釭剑/无视防具' tag,而青釭剑持有者已换下武器,tag 不会自动清除。
//     但本 hook 只在持剑者发起 杀 伤害时设置新 tag,旧 tag 会随玩家死亡/
//     去标签 atom 清理;此处接受这一弱保证。
import type { AtomBeforeContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '青釭剑', description: '武器:杀无视目标防具' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { source?: number; target?: number; cardId?: string };
    // 只对持有者本人发起的伤害生效
    if (atom.source !== ownerId) return;
    if (typeof atom.target !== 'number') return;
    // 动态校核:持有者当前武器槽是否仍装备青釭剑
    // (换下后技能实例虽未立即卸载,本钩子也不再匹配)
    const me = ctx.state.players[ownerId];
    if (!me) return;
    const weaponId = me.equipment?.['武器'];
    if (!weaponId) return;
    const weaponCard = ctx.state.cardMap[weaponId];
    if (!weaponCard || weaponCard.name !== '青釭剑') return;
    // 仅限"杀"造成的伤害:决斗/反伤/属性伤害不无视防具
    if (typeof atom.cardId !== 'string') return;
    const sourceCard = ctx.state.cardMap[atom.cardId];
    if (!sourceCard || !sourceCard.name.includes('杀')) return;
    // 加标签(实际写入 player.marks 为 'tag:青釭剑/无视防具'),
    // 防具 before 钩子后续将读取此 tag 并 pass。
    await applyAtom(ctx.state, { type: '加标签', player: atom.target, tag: '青釭剑/无视防具' });
  });
  return () => {};
}

export default { createSkill, onInit };