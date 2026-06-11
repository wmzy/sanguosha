// src/engine/skills/护甲.ts
// 护甲(曹操·锁定技):当你受到【杀】造成的伤害时,若此牌为黑色,伤害 -1
// 实现:onAtomBefore + guard mark 防 re-entry
import type { AtomBeforeContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '护甲',
    description: '锁定技:受到【杀】造成的伤害时,若此牌为黑色,伤害 -1',
  };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.onAtomBefore('造成伤害', async (ctx: AtomBeforeContext) => {
    if (ctx.atom.target !== api.self) return;
    if (typeof ctx.atom.cardId !== 'string') return;
    const card = ctx.state.cardMap[ctx.atom.cardId];
    if (!card) return;
    if (!card.name.includes('杀')) return;  // 非杀牌不触发
    if (card.suit !== '♠' && card.suit !== '♣') return;  // 仅黑色
    // 防 re-entry:在 damage 被 drop + 重新 apply 时,使用 guard mark 标记
    const self = ctx.state.players.find(p => p.name === api.self);
    if (!self) return;
    if (self.marks.some(m => m.id === '护甲/applied')) return;
    // 应用护甲:drop 重新 apply 减 1,加 guard mark 防止 re-entry
    if (ctx.atom.amount > 0) {
      ctx.api.drop();
      // 先加 guard(在 re-apply 之前)
      await ctx.api.apply({
        type: '加标记',
        player: api.self,
        mark: { id: '护甲/applied', scope: -1 },
      });
      // 重新 apply
      if (ctx.atom.amount > 1) {
        await ctx.api.apply({ ...ctx.atom, amount: ctx.atom.amount - 1 });
      }
      // 否则 amount=1 时不 apply(直接 drop,无伤害)
    }
  });
  return () => {};
}

export const module_护甲: SkillModule = { createSkill, onInit };
registerSkillModule('护甲', module_护甲);
