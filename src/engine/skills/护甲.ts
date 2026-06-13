// src/engine/skills/护甲.ts
// 护甲(曹操·锁定技):当你受到【杀】造成的伤害时,若此牌为黑色,伤害 -1
// 实现:onAtomBefore + guard mark 防 re-entry
import type { Atom, AtomBeforeContext, Skill } from '../types';
import { applyAtom, dropAtom } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '护甲',
    description: '锁定技:受到【杀】造成的伤害时,若此牌为黑色,伤害 -1',
  };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { target?: string; cardId?: string; amount?: number; type: string };
    if (atom.target !== ownerId) return;
    if (typeof atom.cardId !== 'string') return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!card) return;
    if (!card.name.includes('杀')) return;  // 非杀牌不触发
    if (card.suit !== '♠' && card.suit !== '♣') return;  // 仅黑色
    // 防 re-entry:在 damage 被 drop + 重新 apply 时,使用 guard mark 标记
    const self = ctx.state.players.find(p => p.name === ownerId);
    if (!self) return;
    if (self.marks.some(m => m.id === '护甲/applied')) return;
    // 应用护甲:drop 重新 apply 减 1,加 guard mark 防止 re-entry
    if ((atom.amount ?? 0) > 0) {
      dropAtom(ctx.state);
      // 先加 guard(在 re-apply 之前)
      await applyAtom(ctx.state, {
        type: '加标记',
        player: ownerId,
        mark: { id: '护甲/applied', scope: -1 },
      });
      // 重新 apply
      if ((atom.amount ?? 0) > 1) {
        await applyAtom(ctx.state, { ...ctx.atom, amount: (atom.amount ?? 1) - 1 } as Atom);
      }
      // 否则 amount=1 时不 apply(直接 drop,无伤害)
    }
  });
  return () => {};
}

export default { createSkill, onInit };
