// src/engine/skills/寒冰剑.ts
// 寒冰剑(武器):杀造成伤害时可改为弃目标2张牌
import type { AtomBeforeContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '寒冰剑', description: '武器:杀造成伤害时可改为弃目标2张牌' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.onAtomBefore('造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== api.self) return;
    // 检查目标是否有牌可弃
    const target = ctx.state.players.find(p => p.name === atom.target);
    if (!target || target.hand.length === 0) return;
    // 询问是否发动
    await ctx.api.apply({
      type: '请求回应',
      requestType: '寒冰剑/confirm',
      target: api.self,
      prompt: { type: 'confirm', title: '寒冰剑:是否改为弃目标2张牌?', confirmLabel: '弃牌', cancelLabel: '正常伤害' },
      defaultChoice: false,
      timeout: 10000,
    });
    const confirmed = ctx.params.__寒冰剑confirmed as boolean | undefined;
    if (!confirmed) return;
    // 弃目标最多2张牌
    const cards = target.hand.slice(0, 2);
    await ctx.api.apply({ type: '弃置', player: atom.target!, cardIds: cards });
    // 阻止伤害
    ctx.api.drop();
  });
  return () => {};
}

export const module_寒冰剑: SkillModule = { createSkill, onInit };
registerSkillModule('寒冰剑', module_寒冰剑);
