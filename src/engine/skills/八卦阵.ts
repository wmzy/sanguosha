// 八卦阵(防具):当你需要出闪时,判定,若为红色则视为出闪。
// 实现:在 询问闪 before hook 中 applyAtom(判定) → 判定牌在处理区→技能 after hooks 读取→
// afterHooks 清理后判定牌进弃牌堆。八卦阵读弃牌堆顶判定牌花色。
// 红色 → 往处理区放入一张虚拟闪牌,杀检查处理区发现闪就视为闪避。
// 杀不需要知道八卦阵——只看处理区有没有闪牌。
import type { AtomBeforeContext, Card, Skill, GameState} from '../types';
import { applyAtom } from '../create-engine';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '八卦阵',
    description: '防具技:当你需要出闪时,判定,若为红色则视为出闪',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerBeforeHook(skill.id, ownerId, '询问闪', async (ctx: AtomBeforeContext) => {
    if ((ctx.atom as { target?: number }).target !== ownerId) return;
    if (ctx.state.zones.deck.length === 0) return;

    // 判定:牌堆顶→处理区→技能 after hooks 读取→afterHooks 清理(处理区→弃牌堆)
    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '八卦阵' });

    // 判定完成后判定牌已进弃牌堆,读弃牌堆顶
    const discardPile = ctx.state.zones.discardPile;
    if (discardPile.length === 0) return;
    const judgeCardId = discardPile[discardPile.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 红色:往处理区放虚拟闪牌
    if (judgeCard.suit === '♥' || judgeCard.suit === '♦') {
      const dodgeId = `八卦阵:${ownerId}:${judgeCardId}`;
      const virtualDodge: Card = {
        id: dodgeId,
        name: '闪',
        suit: judgeCard.suit,
        rank: judgeCard.rank,
        type: '基本牌',
      };
      ctx.state.cardMap[dodgeId] = virtualDodge;
      ctx.state.zones.processing.push(dodgeId);
    }
  });
  return () => {};
}
