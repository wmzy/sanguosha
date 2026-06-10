// src/engine/skills/贯石斧.ts
// 贯石斧(武器):杀被闪后可弃2张牌强命(伤害仍生效)
import type { AtomAfterContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '贯石斧', description: '武器:杀被闪后可弃2张牌强命' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.onAtomAfter('询问闪', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== api.self) return;
    // 检查是否出了闪(通过 params 标记或 parent frame 的 settlement)
    // 简化: 如果有 __闪避 标记说明目标出了闪
    const dodged = ctx.params.__闪避 as boolean | undefined;
    if (!dodged) return; // 没出闪,不需要强命
    // 检查手牌是否>=2
    const self = ctx.state.players.find(p => p.name === api.self);
    if (!self || self.hand.length < 2) return;
    // 询问是否弃2牌强命
    await ctx.apply({
      type: '请求回应',
      requestType: '贯石斧/confirm',
      target: api.self,
      prompt: { type: 'confirm', title: '贯石斧:是否弃2张牌强命?', confirmLabel: '强命', cancelLabel: '放弃' },
      defaultChoice: false,
      timeout: 10000,
    });
    const confirmed = ctx.params.__贯石斧confirmed as boolean | undefined;
    if (!confirmed) return;
    // 弃2张牌(简化:弃手牌前2张)
    const discardCards = self.hand.slice(0, 2);
    await ctx.apply({ type: '弃置', player: api.self, cardIds: discardCards });
    // 在 parent frame 标记 dodged=false(强命)
    const parent = (ctx as unknown as { _frameRef?: { parent?: { params: Record<string, unknown> } } })._frameRef?.parent;
    if (parent) {
      const settlement = parent.params.settlement as Array<{ target: string; dodged: boolean }> | undefined;
      if (settlement) {
        const item = settlement.find(s => s.target === atom.target);
        if (item) item.dodged = false;
      }
    }
  });
  return () => {};
}

export const module_贯石斧: SkillModule = { createSkill, onInit };
registerSkillModule('贯石斧', module_贯石斧);
