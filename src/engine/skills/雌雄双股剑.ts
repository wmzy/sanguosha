// 雌雄双股剑(武器,攻击范围 2):
//   你使用【杀】指定目标后触发效果:目标弃1张手牌(或你摸1张牌)。
//   简化:不对性别做判断(需角色性别数据),总是触发。
import type { AtomAfterContext, Skill, GameState } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '雌雄双股剑', description: '武器:出杀后,你摸1张牌,目标弃1张牌', isLocked: true };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number; cardId?: string };
    if (atom.source !== ownerId) return;
    // 只在杀的指定目标时触发
    if (atom.cardId) {
      const card = ctx.state.cardMap[atom.cardId];
      if (!card?.name.includes('杀')) return;
    } else {
      return; // 没有 cardId 的事件不触发
    }
    const target = ctx.state.players[atom.target!];
    if (!target || target.hand.length === 0) {
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
      return;
    }
    await applyAtom(ctx.state, { type: '弃置', player: atom.target!, cardIds: [target.hand[0]] });
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
  });
  return () => {};
}
