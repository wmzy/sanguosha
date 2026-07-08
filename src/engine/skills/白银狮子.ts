// 白银狮子(防具):当你受到伤害时,此伤害值最多为 1。
//   失去装备区的白银狮子时回复 1 点体力。
import type { AtomAfterContext, AtomBeforeContext, HookResult, Skill, GameState } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook, registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '白银狮子', description: '防具:每次受伤最多1点' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as {
        target?: number;
        amount?: number;
        source?: number;
        cardId?: string;
      };
      if (atom.target !== ownerId) return;
      if ((atom.amount ?? 0) <= 1) return;
      const me = ctx.state.players[ownerId];
      const armorId = me.equipment['防具'];
      if (!armorId) return;
      const card = ctx.state.cardMap[armorId];
      if (card?.name !== '白银狮子') return;
      return { kind: 'modify', atom: { ...ctx.atom, amount: 1 } as typeof ctx.atom };
    },
  );

  // 失去白银狮子时回 1 血。
  // 卸下 atom 将装备移回手牌(非弃牌堆),故在 before hook 记录被卸下的是否为白银狮子,
  // after hook 据此回血。适用于替换装备、被偷等所有卸下场景。
  const loseKey = `白银狮子/失去/${ownerId}`;
  registerBeforeHook(state, skill.id, ownerId, '卸下', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { player?: number; slot?: string };
    if (atom.player !== ownerId || atom.slot !== '防具') return;
    const armorId = ctx.state.players[ownerId]?.equipment['防具'];
    if (!armorId) return;
    if (ctx.state.cardMap[armorId]?.name !== '白银狮子') return;
    ctx.state.localVars[loseKey] = armorId;
  });
  registerAfterHook(state, skill.id, ownerId, '卸下', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number; slot?: string };
    if (atom.player !== ownerId || atom.slot !== '防具') return;
    const cardId = ctx.state.localVars[loseKey];
    if (!cardId) return;
    delete ctx.state.localVars[loseKey];
    await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
  });

  return () => {};
}
