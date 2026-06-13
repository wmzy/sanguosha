// src/engine/skills/寒冰剑.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   寒冰剑(武器,射程 2):当你使用【杀】对目标造成伤害时,你可以防止此伤害,
//   改为依次弃置目标的 2 张牌(若不足 2 张,弃置所有)。弃置可以来自手牌或装备区。
//
// 关键原子操作:
//   before 钩子(造成伤害):
//     若 source===ownerId ∧ target 有牌 → 请求回应(confirm 是否改为弃牌) →
//     若回应 → 弃置(target.hand[0..2]) → dropAtom(取消伤害)
//
// 关键时机:
//   - 在 造成伤害 atom apply 之前介入,通过 dropAtom 完全取消伤害
//
// 已知问题/不完整实现:
//   1. **未限于"杀"造成的伤害**:任何 source===self 的伤害(决斗/南蛮/反伤等)都触发,
//      违反规则的"使用【杀】对目标造成伤害时"限定。
//      需检查 cardId 或扩展协议带"伤害类型"标识。
//   2. **弃牌固定 hand[0..2]**:目标无法选,违反规则的"依次弃置"(规则上由使用者选/或随机)。
//   3. **不支持装备区弃牌**:规则允许弃装备区的牌,当前仅手牌。
//   4. **drop 后无伤害免疫事件**:dropAtom 沉默取消,前端 UI 无法显示"伤害被寒冰剑取消"——
//      应同步派发"伤害免疫"通知事件。
//   5. **drop + confirm 反模式**:before hook 内 await 等待型 atom(请求回应)
//      然后再 drop——逻辑上是否安全?若玩家不回应(超时 cancel),会 drop 吗?
//      代码逻辑:`if (!confirmed) return;` early return,**不**drop;但 hook 已经污染了 atom 流。
//   6. **目标手牌只有 1 张**:slice(0,2) 取 1 张,规则上"不足 2 张时弃所有"——
//      虽然实现满足"弃所有",但若目标手牌为 0 时应不能触发(规则要求"目标有牌可弃"),
//      虽然 early return 在 if(target.hand.length===0) 处理了。
// ============================================================
import type { AtomBeforeContext, Skill } from '../types';
import { applyAtom, dropAtom } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '寒冰剑', description: '武器:杀造成伤害时可改为弃目标2张牌' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== ownerId) return;
    // 检查目标是否有牌可弃
    const target = ctx.state.players.find(p => p.name === atom.target);
    if (!target || target.hand.length === 0) return;
    // 询问是否发动
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '寒冰剑/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '寒冰剑:是否改为弃目标2张牌?', confirmLabel: '弃牌', cancelLabel: '正常伤害' },
      defaultChoice: false,
      timeout: 10000,
    });
    const confirmed = ctx.params.__寒冰剑confirmed as boolean | undefined;
    if (!confirmed) return;
    // 弃目标最多2张牌
    const cards = target.hand.slice(0, 2);
    await applyAtom(ctx.state, { type: '弃置', player: atom.target!, cardIds: cards });
    // 阻止伤害
    dropAtom(ctx.state);
  });
  return () => {};
}

export default { createSkill, onInit };
