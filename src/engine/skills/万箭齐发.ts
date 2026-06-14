// src/engine/skills/万箭齐发.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   万箭齐发(普通锦囊):出牌阶段,对所有其他角色使用。
//   每名目标依次判定:若不打出【闪】,则受到使用者造成的 1 点伤害。
//   可被【无懈可击】整体取消。
//
// 关键原子操作:
//   use 路径:
//     pushFrame(settlement) → 移动牌(手牌→处理区) →
//     for each target: 询问闪 →
//     for each settlement: 若 !dodged → 造成伤害(amount=1) →
//     移动牌(处理区→弃牌堆) → popFrame
//
// 关键时机:
//   - 询问闪 是等待型 atom(默认 15s 超时)
//   - 闪 的 respond action 通过 frame.params.settlement[].dodged 标记
//
// 已知问题/不完整实现:
//   1. **目标结算顺序**(同南蛮入侵):按 players 数组顺序而非"使用者下家开始"。
//   2. **缺"成为目标"事件**:八卦阵防具的判定需要在"成为万箭目标"时介入,
//      当前直接 询问闪 没有指定目标的中间事件,八卦阵 hook 无法接入(若实现依赖此事件)。
//   3. **无懈可击未支持**:同南蛮——本文件无询问无懈环节。
//   4. **缺"打出闪 vs 使用闪"区分**:万箭齐发的目标是"打出"闪不是"使用"闪,
//      但 询问闪 atom 与杀的询问闪是同一个,无区分——
//      与"使用闪触发某些技能(如某些武将装备)"的场景无法分别 hook。
//   5. **藤甲免疫缺失**:藤甲防具应免疫万箭齐发的伤害,
//      此免疫由 造成伤害 的 before hook(藤甲.ts)处理,但需此处 atom 携带"cardId 或 trickName"信息,
//      当前 造成伤害 atom 不带 cardId(锦囊牌 id 丢失),藤甲无法识别来源。
//   6. validate 不检查 cardId 是否在手牌中。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '万箭齐发', description: '对所有其他角色使用,每名目标需出闪,否则受 1 点伤害' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      const cardId = params.cardId as string;
      const frame = pushFrame(state, '万箭齐发', from, { ...params });

      // 初始化 settlement:所有其他存活角色
      const targets = state.players.filter(p => p.index !== from && p.alive).map(p => p.index);
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
      // 逐个询问闪,每个 respond action(闪技能)通过 frame.parent.params.settlement 标记 dodged
      for (const target of targets) {
        await applyAtom(state, { type: '询问闪', target, source: from });
      }

      // 对未闪避者造成伤害
      const settled = frame.params.settlement as Array<{ target: number; dodged: boolean }>;
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