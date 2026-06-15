// 白银狮子(防具):当你受到伤害时,此伤害值最多为 1。
//   失去装备区的白银狮子时回复 1 点体力。
import type { AtomAfterContext, AtomBeforeContext, HookResult, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '白银狮子', description: '防具:每次受伤最多1点' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
    const atom = ctx.atom as { target?: number; amount?: number; source?: number; cardId?: string };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 1) return;
    const me = ctx.state.players[ownerId];
    const armorId = me?.equipment?.['防具'];
    if (!armorId) return;
    const card = ctx.state.cardMap[armorId];
    if (card?.name !== '白银狮子') return;
    return { kind: 'modify', atom: { ...ctx.atom, amount: 1 } as typeof ctx.atom };
  });

  // 失去白银狮子时回 1 血:监听 卸下(防具) after hook
  registerAfterHook(_skill.id, ownerId, '卸下', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number; slot?: string };
    if (atom.player !== ownerId) return;
    if (atom.slot !== '防具') return;
    // 卸下 后装备从 equipment 移除,卡牌在弃牌堆。检查弃牌堆顶是否为白银狮子。
    const discardPile = ctx.state.zones.discardPile;
    if (discardPile.length === 0) return;
    const topCard = ctx.state.cardMap[discardPile[discardPile.length - 1]];
    if (!topCard || topCard.name !== '白银狮子') return;
    await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
  });

  return () => {};
}
