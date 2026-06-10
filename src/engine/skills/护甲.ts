// src/engine/skills/护甲.ts
// 护甲(曹操·锁定技):当你受到【杀】造成的伤害时,若此牌为黑色,伤害 -1
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
    if (typeof ctx.atom.cardId !== 'string') return;  // 非卡牌伤害(失去体力等)不触发
    const card = ctx.state.cardMap[ctx.atom.cardId];
    if (!card) return;
    if (card.name !== '杀' && !card.name.includes('杀')) return;
    if (card.suit !== '♠' && card.suit !== '♣') return;  // 仅黑色
    ctx.modifyParams({});
    // 通过 atomStack 顶端 0 索引获取正在结算的 atom
    // 简化实现:drop + 重新 apply(amount-1)
    // 真正的实现应通过 settlement frame modifyParams
    if (ctx.atom.amount > 1) {
      ctx.drop();
      await ctx.apply({ ...ctx.atom, amount: ctx.atom.amount - 1 });
    } else {
      ctx.drop();
    }
  });
  return () => {};
}

export const module_护甲: SkillModule = { createSkill, onInit };
registerSkillModule('护甲', module_护甲);
