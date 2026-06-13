// src/engine/skills/遗计.ts
// 遗计(郭嘉·锁定技):当你受到 1 点伤害后,可以摸两张牌,然后将两张牌交给任意角色
// 简化实现:每次受到伤害时,给 self 发请求回应("是否发动遗计?")
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '遗计',
    description: '锁定技:受到 1 点伤害后,摸两张牌,然后将两张牌交给任意角色',
  };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  registerAfterHook(skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    if ((ctx.atom as { target?: string }).target !== ownerId) return;
    if (((ctx.atom as { amount?: number }).amount ?? 0) <= 0) return;
    // 1. 询问是否发动
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '遗计/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '是否发动遗计?', confirmLabel: '发动', cancelLabel: '不发动' },
      defaultChoice: false,
      timeout: 10000,
    });
    // 2. 摸两张牌
    const handBefore = ctx.state.players.find(p => p.name === ownerId)?.hand.length ?? 0;
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 2 });
    // 取摸到的牌:手牌末尾 2 张
    const selfPlayer = ctx.state.players.find(p => p.name === ownerId);
    const drawnCards = selfPlayer ? selfPlayer.hand.slice(-2) : [];
    // 3. 询问分配
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '遗计/distribute',
      target: ownerId,
      prompt: { type: 'distribute', title: '遗计:分配两张牌', cardIds: drawnCards, minPerTarget: 1, maxPerTarget: 2 },
      timeout: 30000,
    });
    // 4. 读取分配结果并逐张给予
    // dispatch 回应路径把 distribute 的 params merge 到 topFrame
    // 客户端回应格式: { allocation: [{ target: 'P1', cardIds: ['c1'] }, ...] }
    const distribution = ctx.params.allocation as Array<{ target: string; cardIds: string[] }> | undefined;
    if (Array.isArray(distribution)) {
      for (const entry of distribution) {
        for (const cardId of entry.cardIds) {
          await applyAtom(ctx.state, { type: '给予', cardId, from: ownerId, to: entry.target });
        }
      }
    }
  });
  return () => {};
}

export default { createSkill, onInit };
