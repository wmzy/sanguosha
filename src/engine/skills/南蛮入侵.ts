// src/engine/skills/南蛮入侵.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   南蛮入侵(普通锦囊):出牌阶段,对所有其他角色使用。
//   每名目标依次判定:若不打出【杀】,则受到使用者造成的 1 点伤害。
//   可被【无懈可击】整体取消。
//
// 关键原子操作:
//   use 路径:
//     pushFrame(settlement=[{target, dodged:false}, ...]) →
//     移动牌(手牌→处理区) →
//     for each target: 询问杀(target, source) →
//     for each settlement: 若 !dodged → 造成伤害(amount=1) →
//     移动牌(处理区→弃牌堆) → popFrame
//
// 关键时机:
//   - 询问杀 是等待型 atom(默认 15s 超时,onTimeout='无操作')
//   - 杀的 respond action(杀.ts)mutate frame.params.settlement[].dodged
//
// 已知问题/不完整实现:
//   1. **目标选择无序**:`filter(p.alive && p.name !== from)` 按 players 数组顺序,
//      不按"使用者下家开始"的标准结算顺序(规则:从使用者的下家开始顺时针)。
//      影响:藤甲反伤等连锁触发的多人结算次序可能错。
//   2. **缺少"成为目标"事件**:标准规则中"成为南蛮目标"会触发某些技能(如某些武将自动出杀),
//      当前直接进 询问杀,无独立的"指定目标"atom 派发,这些技能无法 hook。
//   3. **无懈可击未支持**:虽然无懈可击.ts 存在,但本文件 use 流程没有"询问无懈"环节,
//      锦囊无法被取消(违反标准规则)。
//   4. **激将未支持**:主公成为南蛮目标时,可令蜀势力代出杀——
//      当前 询问杀 只问目标本人,没有激将的 hook 点。
//   5. **缺少摸牌补偿**:在某些扩展规则中,南蛮的目标"打出杀抵消"后,
//      使用者(藤甲反伤等场景下)需要二次结算,当前直接跳过。
//   6. validate 不检查 cardId 是否在手牌中(防御缺失)。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '南蛮入侵', description: '对所有其他角色使用,每名目标需出杀,否则受 1 点伤害' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const cardId = params.cardId as string;
      const frame = pushFrame(state, '南蛮入侵', from, { ...params });

      // 初始化 settlement:所有其他存活角色
      const targets = state.players.filter(p => p.name !== from && p.alive).map(p => p.name);
      const settlement = targets.map(t => ({ target: t, dodged: false }));
      frame.params.settlement = settlement;

      // 移牌到处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // ─── Promise-based 续跑 ───
      // 逐个询问杀:每个 target 的 respond action(如果有)会通过 frame.parent
      // 设置 settlement[i].dodged
      for (const target of targets) {
        await applyAtom(state, { type: '询问杀', target, source: from });
      }

      // 对未出杀者造成伤害
      const settled = frame.params.settlement as Array<{ target: string; dodged: boolean }>;
      for (const item of settled) {
        if (!item.dodged) {
          await applyAtom(state, { type: '造成伤害', target: item.target, amount: 1, source: from });
        }
      }

      // 移牌到弃牌堆
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
