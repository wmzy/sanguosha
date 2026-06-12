// src/engine/skills/八卦阵.ts
// 八卦阵(防具技):当你需要出闪时,判定:若为红色则等效于出闪
// 新设计:不加标签 + 不调 drop——八卦阵只 set 标记,父 action 询问闪后观察 state 决定扣血
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
    if (ctx.state.zones.deck.length === 0) return; // 牌堆空,无法判定

    // 使用判定 atom:deck[0] → judgeZone → after 链后自动入弃牌堆
    await ctx.api.apply({ type: '判定', player: api.self, judgeType: '八卦阵' });

    // 判定牌现在在 judgeZone 顶部
    const self = ctx.state.players.find((p) => p.name === api.self);
    if (!self || self.judgeZone.length === 0) return;
    const judgeCardId = self.judgeZone[self.judgeZone.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (judgeCard && (judgeCard.suit === '♥' || judgeCard.suit === '♦')) {
      // 红色:加 autoDodge 标签(实际存为 mark:tag:八卦阵/autoDodge)
      // 杀.execute 在观察弃牌堆无闪时检查此标记
      // (询问闪继续走完 validate/apply,进入 pending;若用户最终未出闪则 autoDodge 生效)
      await ctx.api.apply({ type: '加标签', player: api.self, tag: '八卦阵/autoDodge' });
    }
    // 黑色:不做事,继续等用户出闪
  });
  return () => {};
}

export const module_八卦阵: SkillModule = { createSkill, onInit };
registerSkillModule('八卦阵', module_八卦阵);
