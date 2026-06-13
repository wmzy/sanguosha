// src/engine/skills/装备通用.ts
// ============================================================
// 技能描述(系统级):
//   所有装备牌共用的 use action——把装备牌装到对应栏位(根据 card.subtype)。
//   注:此技能名 id='装备通用',但 SkillDef.name='装备'。
//
// 关键原子操作:
//   use 路径:
//     pushFrame → (若同槽位已有) 卸下(slot) + 移动牌(处理区→弃牌堆) → 装备(cardId) → popFrame
//
// 关键时机:
//   - 出牌阶段:玩家选择一张装备牌使用
//   - 装备类型由 card.subtype 推断('武器'/'防具'/'进攻马'/'防御马'/'宝物')
//
// 已知问题/不完整实现:
//   1. **卸下旧装备路径错误**:`卸下` atom(atoms/卸下.ts) 把旧装备**返回到手牌**,
//      不是放到处理区!后续 移动牌(处理区→弃牌堆) 是无效操作(处理区里没有该卡)。
//      实际效果是旧装备进了手牌,且弃牌堆操作 silent failure。
//      正确应该是:先把旧装备移到弃牌堆,然后再装新装备(或扩展 卸下 atom 支持 toZone)。
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
//   6. **不支持"装备触发的装备技能"自动添加**:装备牌通常自带技能(如诸葛连弩→无限出杀),
//      装备/卸下应同步 添加技能/移除技能 atom,但本文件没处理——
//      可能在其他模块(equipment 目录?或 装备 atom)处理,需 cross-check。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '装备', description: '装备到对应栏位' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      pushFrame(state, '装备通用', from, { ...params });
      const cardId = params.cardId as string;
      // 先卸下同栏位装备(如果有)
      const card = state.cardMap[cardId];
      if (card?.subtype) {
        const slot = card.subtype as '武器' | '防具' | '进攻马' | '防御马' | '宝物';
        const currentEquip = state.players.find(p => p.name === from)?.equipment?.[slot];
        if (currentEquip) {
          await applyAtom(state, { type: '卸下', player: from, slot });
          await applyAtom(state, { type: '移动牌', cardId: currentEquip, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
      }
      // 装备
      await applyAtom(state, { type: '装备', player: from, cardId });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
