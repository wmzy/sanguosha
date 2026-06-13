// src/engine/skills/藤甲.ts
// 藤甲(防具):普通杀伤害-1(最少0),火焰伤害+1
// 实现:onAtomBefore + guard mark 防 re-entry
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
