// src/engine/skills/酒.ts
// 酒:出牌阶段对自己使用,本回合下一张杀的伤害+1
// 实现:加 mark '酒/nextKillDamageBonus',通过 onAtomBefore('造成伤害') 钩子消费
import type { GameState, Atom, AtomBeforeContext, GameView, Json, Skill  } from '../types';
import { applyAtom, dropAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '酒', description: '出牌阶段对自己使用,本回合下一张杀的伤害+1' };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      // 酒只能对自己用;但 params 不传 target(默认 from)
      // 由 action 路由层保证 from === ownerId
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const frame = pushFrame(state, '酒', from, { ...params });
      const cardId = params.cardId as string;
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      await applyAtom(state, {
        type: '加标记',
        player: from,
        mark: { id: '酒/nextKillDamageBonus', scope: -1, payload: 1, duration: 'turn' },
      });
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      popFrame(state);
    }, );

  // 消费 mark:在造成伤害时,如果是 self 造成的 且 有 酒/nextKillDamageBonus mark,amount + 1
  registerBeforeHook(skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { source?: string; amount?: number; type: string };
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const self = ctx.state.players.find(p => p.name === ownerId);
    if (!self) return;
    const hasMark = self.marks.some(m => m.id === '酒/nextKillDamageBonus');
    if (!hasMark) return;
    // drop + 重新 apply(增加 1) — 简化处理;不会 re-entry 因为 mark 用完即去
    dropAtom(ctx.state);
    await applyAtom(ctx.state, { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as Atom);
    await applyAtom(ctx.state, {
      type: '去标记',
      player: ownerId,
      markId: '酒/nextKillDamageBonus',
    });
  });

  return () => {};
}

export default { createSkill, onInit };
