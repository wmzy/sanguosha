// src/engine/skills/制衡.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   制衡(孙权):出牌阶段限一次,你可以弃置任意张牌,然后摸等量的牌。
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 弃置(cardId) → 摸牌(count=2) → popFrame
//
// 关键时机:
//   - 出牌阶段限一次
//
// 已知问题/不完整实现:
//   1. **限次未实现**:validate 没检查"本回合是否已用过"——
//      标准规则是出牌阶段限一次,当前可任意次发动(违反规则)。
//      应通过 player.vars['制衡/usedThisTurn'] 标记,回合结束清理。
//   2. **弃置数量错误**:规则是"任意张牌,然后摸等量的牌",
//      当前固定单张 + 固定摸 2 张,完全偏离规则!
//      应:弃置 N 张(N≥1),然后摸 N 张。
//   3. **弃牌范围错误**:规则是"任意张牌"(包括手牌和装备),当前只支持单张手牌。
//      onMount 的 prompt 也写死了 min:1, max:1。
//   4. validate 未检查 cardId 是否在手牌中(防御缺失)。
//   5. validate 仅检查 cardId 为 string,未检查长度数组形式(规则允许多张)。
// ============================================================
import type { GameState, FrontendAPI, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '制衡',
    description: '出牌阶段限一次:弃一张手牌,摸两张牌',
  };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const frame = pushFrame(state, '制衡', from, { ...params });
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '弃置', player: from, cardIds: [cardId] });
      await applyAtom(state, { type: '摸牌', player: from, count: 2 });
      popFrame(state);
    }, );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '制衡',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '制衡：选择要弃置的牌',
      cardFilter: { min: 1, max: 1 },
    },
  });
  return () => {};
}

export default { createSkill, onInit, onMount };
