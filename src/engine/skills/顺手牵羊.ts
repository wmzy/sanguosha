// src/engine/skills/顺手牵羊.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   顺手牵羊(普通锦囊):出牌阶段,对距离 1 内的一名其他角色使用。
//   获得其一张牌(可以是手牌/装备/判定区,由你选)。
//   可被【无懈可击】取消。
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) → 获得(target.hand[0]) →
//     移动牌(处理区→弃牌堆) → popFrame
//
// 修复说明:
//   1. validate 增加距离检查:effectiveDistance(ownerId, target) <= 1
//      (委托 distance.ts 统一计算,含 进攻马/防御马 修正)。
//   2. execute 简化为:取目标 hand[0] 移动到自己手牌
//      (规则:使用者从手牌/装备/判定区选;此处按任务要求简化)。
// 待办(本次不修):
//   - 无懈可击未支持
//   - validate 未验证 target!==from、target.alive、cardId 是否在 from.hand
//   - 目标无牌时 silent skip
//   - 不支持装备区/判定区取牌
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';
import { effectiveDistance } from '../distance';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '顺手牵羊', description: '锦囊:获得目标一张牌' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
    if (typeof params.cardId !== 'string') return 'cardId required';
    if (typeof params.target !== 'number') return 'target required';
    // 距离检查:目标必须在距离 1 以内(委托 distance.ts,含 进攻马/防御马 修正)
    if (effectiveDistance(state, ownerId, params.target as number) > 1) {
      return `目标 ${params.target} 不在距离 1 以内`;
    }
    return null;
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      pushFrame(state, '顺手牵羊', from, { ...params });
      const cardId = params.cardId as string;
      const target = params.target as number;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 获得目标一张牌(简化:手牌第一张)
      const targetPlayer = state.players[target];
      if (targetPlayer && targetPlayer.hand.length > 0) {
        await applyAtom(state, { type: '获得', player: from, cardId: targetPlayer.hand[0], from: target });
      }
      // 移锦囊到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
