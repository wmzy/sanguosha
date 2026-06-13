// src/engine/skills/桃园结义.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   桃园结义(普通锦囊):出牌阶段,对所有存活角色使用。
//   每名目标依次回复 1 点体力(以使用者起,顺时针/或按下家开始)。
//   可被【无懈可击】对个别目标取消(每个目标独立可被无懈)。
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) →
//     for each alive player: 回复体力(target, 1) →
//     移动牌(处理区→弃牌堆) → popFrame
//
// 关键时机:
//   - 目标是"所有存活角色"包括使用者
//
// 已知问题/不完整实现:
//   1. **结算顺序错误**:按 players 数组顺序回血,
//      标准规则是"从使用者开始顺时针"(影响:濒死时某个角色能否抢救取决于顺序)。
//   2. **无懈可击未支持**:本文件无询问无懈环节;
//      标准桃园是"每个目标独立可被无懈",需要逐目标询问无懈。
//   3. **未限制满血者不当目标**:满血角色不应该作为合法目标,
//      但当前对所有 alive 一视同仁,会触发空回血事件(虽然 回复体力 atom 可能 silent skip)。
//   4. **未触发"使用锦囊"事件**:同其他锦囊问题。
//   5. validate 未检查 cardId 是否在手牌中。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '桃园结义', description: '锦囊:所有角色各回复1点体力' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      pushFrame(state, '桃园结义', from, { ...params });
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 所有存活角色回复1点
      const players = state.players.filter(p => p.alive);
      for (const p of players) {
        await applyAtom(state, { type: '回复体力', target: p.name, amount: 1 });
      }
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
