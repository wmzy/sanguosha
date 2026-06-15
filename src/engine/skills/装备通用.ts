// src/engine/skills/装备通用.ts
// ============================================================
// 技能描述(系统级):
//   所有装备牌共用的 use action——把装备牌装到对应栏位(根据 card.subtype)。
//   注:此技能名 id='装备通用',但 SkillDef.name='装备'。
//
// 关键原子操作:
//   use 路径:
//     pushFrame → (若同槽位已有) 卸下(slot) + 移动牌(手牌→弃牌堆) → 装备(cardId) → 添加技能(若有) → popFrame
//
// 关键时机:
//   - 出牌阶段:玩家选择一张装备牌使用
//   - 装备类型由 card.subtype 推断('武器'/'防具'/'进攻马'/'防御马'/'宝物')
//
// 已知问题/不完整实现:
//   1. **卸下旧装备的"经过手牌"语义**:`卸下` atom 把旧装备放到手牌,
//      之后再用 移动牌(手牌→弃牌堆) 把它送进弃牌堆——旧装备会瞬间进入手牌(可见),
//      再入弃。视觉上不优雅,且可能干扰依赖"装备离开装备区"的钩子。
//      理想是直接 装备区→弃牌堆(扩展 ZoneLoc 或新增专用 atom),但当前未做。
//   2. **缺新装备的"经过处理区"语义**:标准卡牌使用流程是 手牌→处理区→生效→弃牌堆/装备区,
//      `装备` atom 直接 hand→equipment 跳过处理区,与其他出牌路径不一致——
//      某些技能(如观察处理区的诸葛连弩等)可能无法在装备使用时介入。
//   3. **缺触发"使用装备"事件**:技能(如"奖励装备的武将")无法响应装备使用,
//      因为没有发出独立的"使用装备"事件 atom(只有 装备 atom)。
//   4. **frame 未使用**:pushFrame 后未读取 frame 引用,等同于无操作但有调用开销——
//      可去掉 pushFrame/popFrame,或保留用于将来扩展时统一标识。
//   5. validate 未检查:
//      - cardId 是否在 from 手牌中(防御缺失)
//      - card.subtype 是否为有效装备类型(虽然 装备 atom 会检查,但前置失败信息更友好)
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';
import { skillLoaders } from './index';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '装备', description: '装备到对应栏位' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      pushFrame(state, '装备通用', from, { ...params });
      const cardId = params.cardId as string;
      // 先卸下同栏位装备(如果有):卸下→手牌,再 移动牌→弃牌堆
      const card = state.cardMap[cardId];
      if (card?.subtype) {
        const slot = card.subtype as '武器' | '防具' | '进攻马' | '防御马' | '宝物';
        const currentEquip = state.players[from]?.equipment?.[slot];
        if (currentEquip) {
          await applyAtom(state, { type: '卸下', player: from, slot });
          await applyAtom(state, {
            type: '移动牌',
            cardId: currentEquip,
            from: { zone: '手牌', player: from },
            to: { zone: '弃牌堆' },
          });
        }
      }
      // 装备
      await applyAtom(state, { type: '装备', player: from, cardId });
      // 若装备牌自带技能(以 card.name 作 skillId),动态挂载技能实例
      if (card?.name && skillLoaders[card.name]) {
        await applyAtom(state, { type: '添加技能', player: from, skillId: card.name });
      }
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
