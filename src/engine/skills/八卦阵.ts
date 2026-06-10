// src/engine/skills/八卦阵.ts
// 八卦阵(防具技):当你需要出闪时,判定:若为红色则等效于出闪
import type { AtomBeforeContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '八卦阵',
    description: '防具技:当你需要出闪时,判定,若为红色则视为出闪',
  };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.onAtomBefore('询问闪', async (ctx: AtomBeforeContext) => {
    // 只对自己生效
    if ((ctx.atom as { target?: string }).target !== api.self) return;
    // 判定:翻牌堆顶一张牌
    const state = ctx.state;
    if (state.zones.deck.length === 0) return; // 牌堆空,无法判定
    const judgeCardId = state.zones.deck[0];
    // 翻牌 → 判定 → 弃牌堆
    await ctx.apply({ type: '移动牌', cardId: judgeCardId, from: { zone: '牌堆' }, to: { zone: '弃牌堆' } });
    const judgeCard = state.cardMap[judgeCardId];
    if (judgeCard && (judgeCard.suit === '♥' || judgeCard.suit === '♦')) {
      // 红色:等效出闪 — 阻止询问闪执行,并标记已闪避
      ctx.modifyParams({ __八卦阵生效: true });
      ctx.drop();
    }
    // 黑色:不生效,继续正常询问闪
  });
  return () => {};
}

export const module_八卦阵: SkillModule = { createSkill, onInit };
registerSkillModule('八卦阵', module_八卦阵);
