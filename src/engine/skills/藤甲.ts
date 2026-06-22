// 藤甲(防具):普通杀/非属性锦囊伤害 -1,火焰伤害 +1。
import type { AtomBeforeContext, HookResult, Skill, GameState} from '../types';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '藤甲', description: '防具:普通杀伤害-1,火焰伤害+1' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerBeforeHook(skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
    const atom = ctx.atom as { target?: number; amount?: number; damageType?: string };
    if (atom.target !== ownerId) return;

    const baseAmount = atom.amount ?? 1;
    let newAmount: number;
    if (atom.damageType === 'fire') {
      newAmount = baseAmount + 1;       // 火焰伤害 +1
    } else {
      newAmount = Math.max(0, baseAmount - 1);  // 普通伤害 -1
    }
    if (newAmount === baseAmount) return; // 无变化
    // modify:管线用调整后的 atom 继续,后续 hook(如白银狮子)看到减过的值。
    // 无需 guard mark——modify 不重新进入 before 阶段,无 re-entry。
    return { kind: 'modify', atom: { ...ctx.atom, amount: newAmount } as typeof ctx.atom };
  });
  return () => {};
}

