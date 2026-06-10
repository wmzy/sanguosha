// src/engine/skills/青龙偃月刀.ts
// 青龙偃月刀(武器):目标出闪后可追杀(再出一次杀)
import type { AtomAfterContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '青龙偃月刀', description: '武器:目标出闪后可追杀' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.onAtomAfter('询问闪', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== api.self) return;
    // 目标出了闪才能追杀
    const dodged = ctx.params.__闪避 as boolean | undefined;
    if (!dodged) return;
    // 询问是否追杀
    await ctx.apply({
      type: '请求回应',
      requestType: '青龙偃月刀/confirm',
      target: api.self,
      prompt: { type: 'confirm', title: '青龙偃月刀:目标出闪,是否追杀?', confirmLabel: '追杀', cancelLabel: '放弃' },
      defaultChoice: false,
      timeout: 10000,
    });
    const confirmed = ctx.params.__青龙confirmed as boolean | undefined;
    if (!confirmed) return;
    // 再询问一次闪
    await ctx.apply({ type: '询问闪', target: atom.target!, source: api.self });
  });
  return () => {};
}

export const module_青龙偃月刀: SkillModule = { createSkill, onInit };
registerSkillModule('青龙偃月刀', module_青龙偃月刀);
