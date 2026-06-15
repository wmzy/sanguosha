// src/engine/skills/过河拆桥.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   过河拆桥(普通锦囊):
//     - 使用条件:出牌阶段使用
//     - 目标限制:**1 名其他角色(不能对自己使用)**
//     - 距离限制:**无需距离限制,可对任意距离的其他角色使用**
//     - 效果:你选择该角色区域内(手牌、装备区、判定区)的 1 张牌并弃置之
//     - 备注:可以被【无懈可击】抵消
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) → 弃置(target.hand[0]) →
//     移动牌(处理区→弃牌堆) → popFrame
//
// 关键时机:
//   - 距离限制:**无**——过河拆桥可作用于任意距离的对手
//
// 修复说明:
//   1. validate 不做距离检查(过河拆桥规则上无距离限制)。
//   2. 弃牌目标简化为:hand[0] 或装备区第一槽
//      (规则:使用者从手牌/装备/判定区选;此处按任务要求简化)。
// 待办(本次不修):
//   - 无懈可击未支持
//   - validate 未验证 target!==from、target.alive、cardId 是否在 from.hand
//   - 目标无牌时 silent skip(应改为 validate 拦截)
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '过河拆桥', description: '锦囊:弃置目标一张牌' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'number') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      pushFrame(state, '过河拆桥', from, { ...params });
      const cardId = params.cardId as string;
      const target = params.target as number;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 弃目标一张牌(简化:手牌第一张,无手牌则装备区第一槽)
      const targetPlayer = state.players[target];
      let discardCardId: string | undefined;
      if (targetPlayer && targetPlayer.hand.length > 0) {
        discardCardId = targetPlayer.hand[0];
      } else if (targetPlayer) {
        for (const slot of ['武器', '防具', '进攻马', '防御马', '宝物'] as const) {
          const id = targetPlayer.equipment?.[slot];
          if (id) { discardCardId = id; break; }
        }
      }
      if (discardCardId) {
        await applyAtom(state, { type: '弃置', player: target, cardIds: [discardCardId] });
      }
      // 移锦囊到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };