// src/engine/skills/过河拆桥.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   过河拆桥(普通锦囊):出牌阶段,对距离 1 内的一名其他角色使用(注:某些版本无距离限制)。
//   弃置其一张牌(手牌随机一张/或装备区/判定区由你选)。
//   可被【无懈可击】取消。
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) → 弃置(target.hand[0]) →
//     移动牌(处理区→弃牌堆) → popFrame
//
// 关键时机:
//   - 距离限制:1(标准规则,本文件未实现)
//
// 已知问题/不完整实现:
//   1. **距离限制缺失**:validate 不检查 effectiveDistance(from, target) <= 1,
//      违反标准规则——理论上当前可远距离过河拆桥(实际游戏中破坏平衡)。
//   2. **弃牌目标固定 hand[0]**:简化为弃目标手牌第一张,
//      违反规则(应该是随机一张手牌,或让使用者从手牌/装备/判定区选)。
//      使玩家可预测对手手牌结构,严重影响公平性。
//   3. **不支持装备区/判定区**:规则允许过拆装备和判定区延时锦囊(乐不思蜀等),
//      当前只能弃手牌,导致延时锦囊无法被过拆。
//   4. **无懈可击未支持**:无询问无懈环节。
//   5. validate 未验证 target!==from(允许过拆自己)、target.alive、cardId 在手牌中。
//   6. 目标手牌为 0 时直接 silent skip,不报错——
//      规则上目标无牌时应"无效"或不能指定为目标(validate 阶段拦截更合规)。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '过河拆桥', description: '锦囊:弃置目标一张牌' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'string') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      pushFrame(state, '过河拆桥', from, { ...params });
      const cardId = params.cardId as string;
      const target = params.target as string;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 弃目标一张牌(简化:弃手牌第一张)
      const targetPlayer = state.players.find(p => p.name === target);
      if (targetPlayer && targetPlayer.hand.length > 0) {
        await applyAtom(state, { type: '弃置', player: target, cardIds: [targetPlayer.hand[0]] });
      }
      // 移锦囊到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
