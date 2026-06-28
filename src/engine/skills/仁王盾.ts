// 仁王盾(防具):锁定技,黑色【杀】对你无效。
// 时机:使用结算开始时(检测有效性 before hook)——对应规则"使用结算开始时:检测有效性"。
// 黑色杀 → cancel(表示该目标无效),杀.execute 据返回值跳过该目标
// (不询问闪、不造成伤害、不触发"被抵消")。
//
// 与八卦阵的区别:仁王盾是"杀无效"(在生效前终止,不触发武器技);
// 八卦阵是"视为出闪"(杀被抵消,触发武器技)。两者由时机 atom 天然区分,
// 不再共用 询问闪 的 cancel。
import type { AtomBeforeContext, HookResult, Skill, GameState } from '../types';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '仁王盾', description: '防具:黑色杀对你无效' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerBeforeHook(state, skill.id, ownerId, '检测有效性', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
    const atom = ctx.atom as { target?: number; cardId?: string };
    if (atom.target !== ownerId) return;
    const killCardId = atom.cardId;
    if (!killCardId) return;
    const killCard = ctx.state.cardMap[killCardId];
    if (!killCard || killCard.name !== '杀') return;   // 仅对杀生效(防御未来锦囊复用此 atom)

    // 黑色杀无效:cancel 检测有效性 → 杀.execute 跳过该目标
    if (killCard.color === '黑') {
      return { kind: 'cancel' };
    }
  });
  return () => {};
}
