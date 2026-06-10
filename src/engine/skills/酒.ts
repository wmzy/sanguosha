// src/engine/skills/酒.ts
// 酒:出牌阶段对自己使用,本回合下一张杀的伤害+1
// 实现:加 mark '酒/nextKillDamageBonus',通过 onAtomBefore('造成伤害') 钩子消费
import type { AtomBeforeContext, BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '酒', description: '出牌阶段对自己使用,本回合下一张杀的伤害+1' };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      // 酒只能对自己用;但 params 不传 target(默认 from)
      // 由 action 路由层保证 from === ownerId
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;
      await frame.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      await frame.apply({
        type: '加标记',
        player: from,
        mark: { id: '酒/nextKillDamageBonus', scope: -1, payload: 1, duration: 'turn' },
      });
      await frame.apply({
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    },
  );

  // 消费 mark:在造成伤害时,如果是 self 造成的 且 有 酒/nextKillDamageBonus mark,amount + 1
  api.onAtomBefore('造成伤害', async (ctx: AtomBeforeContext) => {
    if (ctx.atom.source !== api.self) return;
    if (ctx.atom.amount <= 0) return;
    const self = ctx.state.players.find(p => p.name === api.self);
    if (!self) return;
    const hasMark = self.marks.some(m => m.id === '酒/nextKillDamageBonus');
    if (!hasMark) return;
    // drop + 重新 apply(增加 1) — 简化处理;不会 re-entry 因为 mark 用完即去
    ctx.drop();
    await ctx.apply({ ...ctx.atom, amount: ctx.atom.amount + 1 });
    await ctx.apply({
      type: '去标记',
      player: api.self,
      markId: '酒/nextKillDamageBonus',
    });
  });

  return () => {};
}

export const module_酒: SkillModule = { createSkill, onInit };
registerSkillModule('酒', module_酒);
