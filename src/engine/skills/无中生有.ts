// src/engine/skills/无中生有.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   无中生有(普通锦囊):出牌阶段,对自己使用,你摸两张牌。
//   可被【无懈可击】取消。
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) → 摸牌(from, 2) →
//     移动牌(处理区→弃牌堆) → popFrame
//
// 关键时机:
//   - 仅出牌阶段,目标必须是自己
//
// 已知问题/不完整实现:
//   1. **无懈可击未支持**:虽然可对自己用,但无懈仍可被其他玩家打出取消——
//      当前 use 流程无询问无懈环节。
//   2. **未约束目标为 self**:validate 无 target 参数,默认是 self,
//      但若 params 误传了 target 给非 self,代码没拒绝(目前没有 target 使用,影响小)。
//   3. validate 未检查 cardId 是否在手牌中、是否是真的"无中生有"卡名。
//   4. 摸牌前后未触发"使用锦囊"事件,某些技能(如某些武将的"反制锦囊")无 hook。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '无中生有', description: '锦囊:摸两张牌' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      pushFrame(state, '无中生有', from, { ...params });
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      await applyAtom(state, { type: '摸牌', player: from, count: 2 });
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
