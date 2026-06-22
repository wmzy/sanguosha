// 仁王盾(防具):锁定技,黑色【杀】对你无效。
// 时机:询问闪 before hook——黑色杀直接 cancel 询问闪(跳过出闪流程),
// 往处理区放一张虚拟闪牌表示"杀无效",杀.execute 检查处理区发现有闪就不造成伤害。
// 和八卦阵统一模式:杀零感知仁王盾,只看处理区。
import type { AtomBeforeContext, Card, HookResult, Skill, GameState} from '../types';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '仁王盾', description: '防具:黑色杀对你无效' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerBeforeHook(skill.id, ownerId, '询问闪', async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
    const atom = ctx.atom as { target?: number; source?: number };
    if (atom.target !== ownerId) return;

    // 查杀牌:从处理区找当前正在结算的杀(最近一张进处理区的杀牌)
    const killCardId = ctx.state.zones.processing.find(id => {
      const c = ctx.state.cardMap[id];
      return c && c.name === '杀';
    });
    if (!killCardId) return;
    const killCard = ctx.state.cardMap[killCardId];
    if (!killCard) return;

    // 黑色杀无效:往处理区放虚拟闪牌,取消询问闪
    if (killCard.suit === '♠' || killCard.suit === '♣') {
      const virtualDodgeId = `仁王盾:${ownerId}:${killCardId}`;
      const virtualDodge: Card = {
        id: virtualDodgeId,
        name: '闪',
        suit: killCard.suit,
        rank: killCard.rank,
        type: '基本牌',
      };
      ctx.state.cardMap[virtualDodgeId] = virtualDodge;
      ctx.state.zones.processing.push(virtualDodgeId);
      return { kind: 'cancel' };
    }
  });
  return () => {};
}

