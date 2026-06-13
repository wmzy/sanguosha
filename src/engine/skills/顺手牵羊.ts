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
// 关键时机:
//   - 距离限制:1
//
// 已知问题/不完整实现:
//   1. **距离限制缺失**(同过河拆桥):未检查 effectiveDistance <= 1。
//   2. **获取牌固定 hand[0]**(同过河拆桥):严重影响公平性,应让使用者选。
//   3. **不支持装备区/判定区**(同过河拆桥):无法顺取装备或延时锦囊。
//   4. **不支持随机手牌**:标准规则中"获得手牌"应该不可见(随机一张),
//      当前直接取 hand[0] 是确定性,使用者能预测获得什么——破坏盲取语义。
//   5. **无懈可击未支持**。
//   6. validate 同样未校验 target!==from、alive、cardId 是否在手牌中。
//   7. 目标无牌时 silent skip(同过河拆桥)。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '顺手牵羊', description: '锦囊:获得目标一张牌' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'string') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      pushFrame(state, '顺手牵羊', from, { ...params });
      const cardId = params.cardId as string;
      const target = params.target as string;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 获得目标一张牌(简化:手牌第一张)
      const targetPlayer = state.players.find(p => p.name === target);
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
