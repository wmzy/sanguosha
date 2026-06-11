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
    if ((ctx.atom as { target?: string }).target !== api.self) return;
    if (((ctx.atom as { amount?: number }).amount ?? 0) <= 0) return;
    // 1. 询问是否发动
    await ctx.api.apply({
      type: '请求回应',
      requestType: '遗计/confirm',
      target: api.self,
      prompt: { type: 'confirm', title: '是否发动遗计?', confirmLabel: '发动', cancelLabel: '不发动' },
      defaultChoice: false,
      timeout: 10000,
    });
    // 2. 摸两张牌
    const handBefore = ctx.state.players.find(p => p.name === api.self)?.hand.length ?? 0;
    await ctx.api.apply({ type: '摸牌', player: api.self, count: 2 });
    // 取摸到的牌:手牌末尾 2 张
    const selfPlayer = ctx.state.players.find(p => p.name === api.self);
    const drawnCards = selfPlayer ? selfPlayer.hand.slice(-2) : [];
    // 3. 询问分配
    await ctx.api.apply({
      type: '请求回应',
      requestType: '遗计/distribute',
      target: api.self,
      prompt: { type: 'distribute', title: '遗计:分配两张牌', cardIds: drawnCards, minPerTarget: 1, maxPerTarget: 2 },
      timeout: 30000,
    });
    // 4. 读取分配结果并逐张给予
    // dispatch 把回应 params 注入到 settlement frame 的 params 中
    // 客户端回应格式: { __遗计分配: [{ target: 'P1', cardIds: ['c1'] }, ...] }
    const distribution = ctx.params.__遗计分配 as Array<{ target: string; cardIds: string[] }> | undefined;
    if (Array.isArray(distribution)) {
      for (const entry of distribution) {
        for (const cardId of entry.cardIds) {
          await ctx.api.apply({ type: '给予', cardId, from: api.self, to: entry.target });
        }
      }
    }
  });
  return () => {};
}

export const module_遗计: SkillModule = { createSkill, onInit };
registerSkillModule('遗计', module_遗计);
