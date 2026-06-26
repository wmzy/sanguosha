// 护甲(项目自定义锁定技):当你受到【杀】造成的伤害时,若此杀为黑色,伤害 -1。
import type { AtomBeforeContext, HookResult, Skill, GameState} from '../types';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '护甲',
    description: '锁定技:受到【杀】造成的伤害时,若此牌为黑色,伤害 -1',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerBeforeHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
    const atom = ctx.atom as { target?: number; cardId?: string; amount?: number; type: string };
    if (atom.target !== ownerId) return;
    if (typeof atom.cardId !== 'string') return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!card) return;
    if (!card.name.includes('杀')) return;
    if (card.suit !== '♠' && card.suit !== '♣') return;  // 仅黑色
    const baseAmount = atom.amount ?? 0;
    if (baseAmount <= 0) return;
    return { kind: 'modify', atom: { ...ctx.atom, amount: baseAmount - 1 } as typeof ctx.atom };
  });
  return () => {};
}

