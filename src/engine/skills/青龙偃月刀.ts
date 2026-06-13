// src/engine/skills/青龙偃月刀.ts
// 青龙偃月刀(武器):目标出闪后可追杀(再出一次杀)
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '青龙偃月刀', description: '武器:目标出闪后可追杀' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAfterHook(_skill.id, ownerId, '询问闪', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== ownerId) return;
    // 目标出了闪才能追杀
    const dodged = ctx.params.__闪避 as boolean | undefined;
    if (!dodged) return;
    // 询问是否追杀
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '青龙偃月刀/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '青龙偃月刀:目标出闪,是否追杀?', confirmLabel: '追杀', cancelLabel: '放弃' },
      defaultChoice: false,
      timeout: 10000,
    });
    const confirmed = ctx.params.__青龙confirmed as boolean | undefined;
    if (!confirmed) return;
    // 再询问一次闪
    await applyAtom(ctx.state, { type: '询问闪', target: atom.target!, source: ownerId });
  });
  return () => {};
}

export default { createSkill, onInit };
