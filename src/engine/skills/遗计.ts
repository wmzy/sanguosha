// src/engine/skills/遗计.ts
// 遗计(郭嘉·锁定技):当你受到 1 点伤害后,可以摸两张牌,然后将两张牌交给任意角色
// 简化实现:每次受到伤害时,给 self 发请求回应("是否发动遗计?")
import type { AtomAfterContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '遗计',
    description: '锁定技:受到 1 点伤害后,摸两张牌,然后将两张牌交给任意角色',
  };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.onAtomAfter('造成伤害', async (ctx: AtomAfterContext) => {
    if (ctx.atom.target !== api.self) return;
    if (ctx.atom.amount <= 0) return;
    await ctx.apply({
      type: '请求回应',
      requestType: '遗计/confirm',
      target: api.self,
      prompt: { type: 'confirm', title: '是否发动遗计?', confirmLabel: '发动', cancelLabel: '不发动' },
      defaultChoice: false,
      timeout: 10000,
    });
    await ctx.apply({ type: '摸牌', player: api.self, count: 2 });
    await ctx.apply({
      type: '请求回应',
      requestType: '遗计/distribute',
      target: api.self,
      prompt: { type: 'distribute', title: '遗计:分配两张牌', cardIds: [], minPerTarget: 1, maxPerTarget: 2 },
      timeout: 30000,
    });
    // 分配结果通过 settlement params 传递;此处简化,后续 PR 接入
  });
  return () => {};
}

export const module_遗计: SkillModule = { createSkill, onInit };
registerSkillModule('遗计', module_遗计);
