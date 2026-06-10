// src/engine/skills/反馈.ts
// 反馈(司马懿·锁定技):当你受到伤害后,你可以获得伤害来源的一张牌
import type { AtomAfterContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '反馈',
    description: '锁定技:受到伤害后,你可以获得伤害来源的一张牌',
  };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.onAtomAfter('造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: string; source?: string; amount?: number };
    if (atom.target !== api.self) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (!atom.source) return;
    // 检查来源是否有牌
    const sourcePlayer = ctx.state.players.find(p => p.name === atom.source);
    if (!sourcePlayer) return;
    const hasCards = sourcePlayer.hand.length > 0 || Object.keys(sourcePlayer.equipment).length > 0;
    if (!hasCards) return;
    // 询问是否发动
    await ctx.apply({
      type: '请求回应',
      requestType: '反馈/confirm',
      target: api.self,
      prompt: { type: 'confirm', title: '是否发动反馈?', confirmLabel: '发动', cancelLabel: '不发动' },
      defaultChoice: false,
      timeout: 10000,
    });
    const confirmed = ctx.params.__反馈confirmed as boolean | undefined;
    if (!confirmed) return;
    // 获得来源的一张牌(简化:取手牌第一张,优先手牌)
    const source = ctx.state.players.find(p => p.name === atom.source);
    if (!source) return;
    let cardId: string | undefined;
    if (source.hand.length > 0) {
      cardId = source.hand[0];
      await ctx.apply({ type: '获得', player: api.self, cardId, from: atom.source });
    } else {
      const equipSlot = Object.keys(source.equipment)[0] as keyof typeof source.equipment;
      if (equipSlot) {
        cardId = source.equipment[equipSlot];
        if (cardId) {
          await ctx.apply({ type: '获得', player: api.self, cardId, from: atom.source });
        }
      }
    }
  });
  return () => {};
}

export const module_反馈: SkillModule = { createSkill, onInit };
registerSkillModule('反馈', module_反馈);
